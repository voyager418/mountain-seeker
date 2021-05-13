import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { Container, Service } from "typedi";
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { TradingState } from "../models/trading-state";
import { v4 as uuidv4 } from 'uuid';
import { BinanceConnector } from "../api-connectors/binance-connector";
import { getCandleStick, getCandleStickPercentageVariation, getCurrentCandleStickPercentageVariation, Market } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import cliProgress from 'cli-progress';
import { StrategyUtils } from "../utils/strategy-utils";
import { GlobalUtils } from "../utils/global-utils";
import { Order } from "../models/order";
import { EmailService } from "../services/email-service";
const CONFIG = require('config');


/**
 * The general goal of this strategy is to select and buy an action
 * that is, and recently was, harshly rising in price.
 * Then sell it when the price starts to decrease.
 */
@Service({ transient: true })
export class MountainSeeker implements BaseStrategy {
    private readonly strategyDetails;
    private readonly account: Account;
    private readonly apiConnector: BinanceConnector;
    private readonly emailService: EmailService;
    private readonly CANDLE_STICKS_TO_FETCH = 60;
    private marketUnitPriceOfOriginAssetInEur = -1;
    private initialWalletBalance?: Map<Currency, number>;
    private refilledWalletBalance?: Map<Currency, number>;

    private state: TradingState = {
        id: uuidv4()
    };

    constructor(account: Account, strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        Container.set("BINANCE_API_KEY", account.apiKey);
        Container.set("BINANCE_API_SECRET", account.apiSecret);
        this.account = account;
        this.strategyDetails = strategyDetails;
        this.apiConnector = Container.get(BinanceConnector);
        this.emailService = Container.get(EmailService);
        this.initDefaultConfig(strategyDetails);
        this.state.config = strategyDetails;
        if (!CONFIG.simulation && process.env.NODE_ENV !== "prod") {
            log.warn("WARNING : this is not a simulation");
        }
    }

    /**
     * Sets default config values
     * // TODO : there might be a better way to set default parameters
     */
    private initDefaultConfig(strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        if (!strategyDetails.config.authorizedCurrencies) {
            this.strategyDetails.config.authorizedCurrencies =
                [Currency.EUR, Currency.BTC, Currency.BNB, Currency.ETH];
        }
        if (!strategyDetails.config.candleStickInterval) {
            this.strategyDetails.config.candleStickInterval = "1m";
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.strategyDetails.config.minimumPercentFor24hVariation = 1;
        }
        if (!strategyDetails.config.authorizedMarkets) {
            this.strategyDetails.config.authorizedMarkets = [];
        }
        if (!strategyDetails.config.minimumTradingVolumeLast24h) {
            this.strategyDetails.config.minimumTradingVolumeLast24h = 100;
        }
        if (!strategyDetails.config.initialSecondsToSleepInTheTradingLoop) {
            this.strategyDetails.config.initialSecondsToSleepInTheTradingLoop = 3;
        }
        if (!strategyDetails.config.initialStopLimitPriceIncreaseInTheTradingLoop) {
            this.strategyDetails.config.initialStopLimitPriceIncreaseInTheTradingLoop = 0.1;
        }
        if (!strategyDetails.config.initialStopLimitPriceTriggerPercent) {
            this.strategyDetails.config.initialStopLimitPriceTriggerPercent = 1.0;
        }
        if (!strategyDetails.config.secondsToSleepInTheTradingLoop) {
            this.strategyDetails.config.secondsToSleepInTheTradingLoop = 60;
        }
        if (!strategyDetails.config.stopLimitPriceIncreaseInTheTradingLoop) {
            this.strategyDetails.config.stopLimitPriceIncreaseInTheTradingLoop = 0.5;
        }
        if (!strategyDetails.config.stopLimitPriceTriggerPercent) {
            this.strategyDetails.config.stopLimitPriceTriggerPercent = 2.5;
        }
    }


    public async run(): Promise<TradingState> {
        // Fetch data and select market
        const markets: Array<Market> = await this.fetchMarkets(this.strategyDetails.config.minimumPercentFor24hVariation!,
            this.strategyDetails.config.candleStickInterval!)
            .catch(e => Promise.reject(e));
        const market = this.selectMarketForTrading(markets);
        // const market = markets[0]; // attention if the stop price is bigger than current price, it will not work

        if (!market) {
            log.info("No market was found");
            return Promise.resolve(this.state);
        }

        log.debug(`Using config : ${JSON.stringify(this.strategyDetails, null, 4)}`);
        this.apiConnector.setMarketMinNotional(market);
        this.apiConnector.printMarketDetails(market.symbol);
        this.state.marketSymbol = market.symbol;
        this.state.candleSticksPercentageVariations = market.candleSticksPercentageVariations;
        log.info("Found market %O", market.symbol);
        log.debug("Last 3 candlestick's percentage variations with %O interval : %O",
            this.strategyDetails.config.candleStickInterval,
            market.candleSticksPercentageVariations.slice(market.candleSticksPercentageVariations.length - 3));

        // Prepare wallet
        await this.prepareWallet(market, this.strategyDetails.config.authorizedCurrencies!)
            .catch(e => Promise.reject(e));
        const availableOriginAssetAmount = this.refilledWalletBalance?.get(market.originAsset);
        if (availableOriginAssetAmount === undefined) {
            return Promise.reject("No amount of origin asset in the wallet");
        }

        // Compute the amount of target asset to buy
        const amountToInvest = this.computeAmountToInvest(market, availableOriginAssetAmount);
        let marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset, true)
            .catch(e => Promise.reject(e));
        const amountOfTargetAssetToTrade = amountToInvest/marketUnitPrice;
        log.debug("Preparing to execute the first order to buy %O %O on %O market. (≈ %O %O). Market unit price is %O",
            amountOfTargetAssetToTrade, market.targetAsset, market.symbol, amountToInvest, market.originAsset, marketUnitPrice);

        // Before buying, one last check that the price still rises
        // if current price dropped below the 2nd candlestick's close price
        if (marketUnitPrice < market.candleSticks[market.candleSticks.length - 2][4]) {
            if (market.originAsset === Currency.EUR) {
                log.info(`Trading canceled for market ${JSON.stringify(market, null, 4)}`);
                return Promise.resolve(this.state);
            } else {
                await this.handleSellY(market, availableOriginAssetAmount);
                this.state.profitEuro = this.state.retrievedAmountOfEuro! - this.state.investedAmountOfEuro!;
                this.state.percentChange = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro!);
                log.info(`Final percent change : ${this.state.percentChange}`);
                await this.emailService.sendEmail(`Trading canceled for ${market.symbol} (${this.state.percentChange > 0
                    ? '+' : ''}${this.state.percentChange.toFixed(3)}%, ${this.state.profitEuro.toFixed(2)}€)`, "Final state is : \n" +
                    JSON.stringify(this.state, null, 4));
                log.info(`Trading finished ${JSON.stringify(this.state, null, 4)}`);
                return Promise.resolve(this.state);
            }
        }

        // First BUY order
        const buyOrder = await this.apiConnector.createMarketOrder(market.originAsset, market.targetAsset,
            "buy", amountOfTargetAssetToTrade, true, 3, amountToInvest).catch(e => Promise.reject(e));
        if (this.state.originAssetIsEur) {
            this.state.investedAmountOfEuro = buyOrder.amountOfOriginAsset;
        }
        this.state.amountOfYSpentOnZ = buyOrder.amountOfOriginAsset;

        // First STOP-LIMIT order

        // minimum between low of xth and yth candlestick starting from end
        let stopLimitPrice = Math.min(
            getCandleStick(market.candleSticks, market.candleSticks.length - 13)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 12)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 11)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 10)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 9)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 8)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 7)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 6)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 5)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 4)[3],
            getCandleStick(market.candleSticks, market.candleSticks.length - 3)[3]);

        const targetAssetAmount = buyOrder.filled;
        let stopLimitOrder = await this.apiConnector.createStopLimitOrder(market.originAsset, market.targetAsset,
            "sell", targetAssetAmount, stopLimitPrice, stopLimitPrice, 3)
            .catch(e => Promise.reject(e));

        this.emailService.sendEmail(`Trading started on ${market.symbol}`,
            "Current state : \n" + JSON.stringify(this.state, null, 4)).then();

        // Price monitor loop
        let newStopLimitPrice = buyOrder.average!;
        let secondsToSleepInTheTradingLoop = this.strategyDetails.config.initialSecondsToSleepInTheTradingLoop!;
        let stopLimitPriceTriggerPercent = this.strategyDetails.config.initialStopLimitPriceTriggerPercent!;
        let stopLimitPriceIncreaseInTheTradingLoop = this.strategyDetails.config.initialStopLimitPriceIncreaseInTheTradingLoop!;
        while (stopLimitPrice < marketUnitPrice) {
            await GlobalUtils.sleep(secondsToSleepInTheTradingLoop);
            if ((await this.apiConnector.getOrder(stopLimitOrder.externalId, stopLimitOrder.originAsset, stopLimitOrder.targetAsset,
                stopLimitOrder.id, stopLimitOrder.type!, 3)).status === "closed") {
                break;
            }
            marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset)
                .catch(e => log.error(e));

            if (StrategyUtils.getPercentVariation(newStopLimitPrice, marketUnitPrice) >= stopLimitPriceTriggerPercent) {
                // cancel the previous stop limit order
                await this.apiConnector.cancelOrder(stopLimitOrder.externalId, stopLimitOrder.id,
                    market.originAsset, market.targetAsset).catch(e => Promise.reject(e));

                // compute new stop limit price
                newStopLimitPrice = newStopLimitPrice + (newStopLimitPrice * (stopLimitPriceIncreaseInTheTradingLoop/100));
                stopLimitPrice = newStopLimitPrice;

                // create new stop limit order
                stopLimitOrder = await this.apiConnector.createStopLimitOrder(market.originAsset, market.targetAsset,
                    "sell", targetAssetAmount, newStopLimitPrice, newStopLimitPrice, 3)
                    .catch(e => Promise.reject(e));

                // after the first stop limit order in the loop is done -> parameters are slightly changed
                secondsToSleepInTheTradingLoop = this.strategyDetails.config.secondsToSleepInTheTradingLoop!;
                stopLimitPriceTriggerPercent = this.strategyDetails.config.stopLimitPriceTriggerPercent!;
                stopLimitPriceIncreaseInTheTradingLoop = this.strategyDetails.config.stopLimitPriceIncreaseInTheTradingLoop!;
            }
            this.state.pricePercentChangeOnZY = StrategyUtils.getPercentVariation(buyOrder.average!, stopLimitPrice);
            log.info(`Buy : ${buyOrder.average}, current : ${(marketUnitPrice)
                .toFixed(8)}, change % : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                marketUnitPrice)).toFixed(3)}% | Sell price : ${stopLimitPrice
                .toFixed(8)} | Profit : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                newStopLimitPrice)).toFixed(3)}%`);
        }

        await this.handleTradeEnd(market, stopLimitOrder).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        log.info(`Trading finished ${JSON.stringify(this.state, null, 4)}`);
        return Promise.resolve(this.state);
    }

    /**
     * If the market is 'WIN/BNB' then 'Y' stands for 'BNB'
     */
    private async handleSellY(market: Market, amountToSell: number) {
        const order = await this.apiConnector.createMarketOrder(Currency.EUR, market.originAsset,
            "sell", amountToSell, true).catch(e => Promise.reject(e));
        this.state.retrievedAmountOfEuro = order.amountOfOriginAsset;
        this.state.endUnitPriceOnYXMarket = order.average;
        this.state.pricePercentChangeOnYX = StrategyUtils.getPercentVariation(this.state.initialUnitPriceOnYXMarket!,
            this.state.endUnitPriceOnYXMarket!);
    }

    /**
     * If the initial selected market was not accepting EUR (e.g. "CAKE/BNB")
     * then the full amount of origin asset is traded for EUR (e.g. => BNB is sold on "BNB/EUR" market)
     */
    private async handleTradeEnd(market: Market, lastStopLimitOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder = await this.apiConnector.waitForOrderCompletion(lastStopLimitOrder, market.originAsset,
            market.targetAsset, 3).catch(e => Promise.reject(e));
        if (!completedOrder) { // stop limit order took too much => use a MARKET order
            await this.apiConnector.cancelOrder(lastStopLimitOrder.externalId, lastStopLimitOrder.id,
                lastStopLimitOrder.originAsset, lastStopLimitOrder.targetAsset).catch(e => Promise.reject(e));
            completedOrder = await this.apiConnector.createMarketOrder(Currency.EUR, market.originAsset,
                "sell", lastStopLimitOrder.amountOfTargetAsset, true).catch(e => Promise.reject(e));
        }
        if (market.originAsset === Currency.EUR) {
            this.state.retrievedAmountOfEuro = completedOrder!.amountOfOriginAsset!;
        } else {
            const amountOfYToSell = (this.state.amountOfYBought! - this.state.amountOfYSpentOnZ!) + completedOrder!.amountOfOriginAsset!
            await this.handleSellY(market, amountOfYToSell);
        }
        this.state.profitEuro = this.state.retrievedAmountOfEuro! - this.state.investedAmountOfEuro!;
        this.state.percentChange = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro!);
        log.info(`Final percent change : ${this.state.percentChange}`);

        const endWalletBalance = await this.apiConnector.getBalance(this.strategyDetails.config.authorizedCurrencies!)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));

        await this.emailService.sendEmail(`Trading finished on ${market.symbol} (${this.state.percentChange > 0
            ? '+' : ''}${this.state.percentChange.toFixed(3)}%, ${this.state.profitEuro.toFixed(2)}€)`, "Final state is : \n" +
            JSON.stringify(this.state, null, 4));
        return Promise.resolve();
    }

    /**
     * @return The amount of ${@link Market.originAsset} that will be invested
     */
    private computeAmountToInvest(market: Market, availableOriginAssetAmount: number): number {
        if (market.originAsset === Currency.EUR) {
            this.state.originAssetIsEur = true;
            return Math.min(availableOriginAssetAmount, this.strategyDetails.config.maxMoneyToTrade);
        } else {
            this.state.originAssetIsEur = false;
            return this.state.amountOfYBought!;
        }
    }

    /**
     * Searches the best market based on some criteria.
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private selectMarketForTrading(markets: Array<Market>): Market | undefined {
        const potentialMarkets = [];
        for (const market of markets) {
            const candleStickVariations: number[] = market.candleSticksPercentageVariations;
            const currentVariation = getCurrentCandleStickPercentageVariation(candleStickVariations);

            if (this.strategyDetails.config.candleStickInterval === "15m") {
                if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as
                    !candleStickVariations.some(variation => variation === 0)) {      // PHB/BTC, QKC/BTC or DF/ETH in Binance
                    if (currentVariation >= 0.1 && currentVariation <= 3) { // if current price is increasing
                        const previousVariation = getCandleStickPercentageVariation(candleStickVariations,
                            market.candleSticksPercentageVariations.length - 2);
                        if (previousVariation >= 9 && previousVariation <= 37) { // if previous price increased between x and y%
                            log.debug(`Potential market : ${JSON.stringify(market)}`);
                            if (!candleStickVariations.slice(candleStickVariations.length - 4, candleStickVariations.length - 2)
                                .some(variation => variation > 6 || variation < -5)) { // if the third and fourth candle stick starting from the end, do not exceed x% and is not less than y%
                                // if closing price of previous candle stick is < than the open price of the current one
                                if (market.candleSticks[market.candleSticks.length - 2][4] < market.candleSticks[market.candleSticks.length - 1][1]) {
                                    // all candlesticks except the last two should not have variation bigger than x%
                                    if (!candleStickVariations.slice(0, candleStickVariations.length - 2)
                                        .some(variation => variation > 10)) {
                                        potentialMarkets.push(market);
                                    }
                                }
                            }
                        }
                    }
                }
            } else if (this.strategyDetails.config.candleStickInterval === "1m") {
                if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as
                    !candleStickVariations.some(variation => variation === 0)) {      // PHB/BTC, QKC/BTC or DF/ETH in Binance
                    if (currentVariation >= 0.1) { // if current price is increasing
                        // if the variation between open price of 4th candle and close price of 2nd candle >= x%
                        // OR if the variation between open price of xth candle and close price of 2nd candle >= x%
                        if (StrategyUtils.getPercentVariation(market.candleSticks[market.candleSticks.length - 4][1],
                            market.candleSticks[market.candleSticks.length - 2][4]) >= 9 ||
                            StrategyUtils.getPercentVariation(market.candleSticks[market.candleSticks.length - 16][1],
                                market.candleSticks[market.candleSticks.length - 2][4]) >= 9) {
                            log.debug(`Potential market : ${JSON.stringify(market)}`);
                            // if all variations except the last x, do not exceed x%
                            // OR the open price of last candle is < than open price of xth candle
                            if (!candleStickVariations.slice(0, candleStickVariations.length - 16)
                                .some(variation => Math.abs(variation) > 2.5) ||
                                market.candleSticks[0][1] < market.candleSticks[market.candleSticks.length - 16][1]
                            ) {
                                potentialMarkets.push(market);
                            }
                        }
                    }
                }
            }
        }

        if (potentialMarkets.length > 0) {
            // return the market with the highest previous candlestick % variation
            return potentialMarkets.reduce((prev, current) =>
                ((getCandleStickPercentageVariation(prev.candleSticksPercentageVariations,
                    prev.candleSticksPercentageVariations.length - 2) >
                    getCandleStickPercentageVariation(current.candleSticksPercentageVariations,
                        current.candleSticksPercentageVariations.length - 2)) ? prev : current));
        }

        return undefined;
    }

    /**
     * @return All potentially interesting markets
     */
    private async fetchMarkets(minimumPercentVariation: number, candleStickInterval: string): Promise<Array<Market>> {
        let markets: Array<Market> = await this.apiConnector.getMarketsBy24hrVariation(minimumPercentVariation)
            .catch(e => Promise.reject(e));
        this.apiConnector.setMarketAmountPrecision(markets);
        markets = StrategyUtils.filterByAuthorizedCurrencies(markets, this.strategyDetails.config.authorizedCurrencies);
        markets = StrategyUtils.filterByMinimumTradingVolume(markets, this.strategyDetails.config.minimumTradingVolumeLast24h);
        markets = StrategyUtils.filterByIgnoredMarkets(markets, this.strategyDetails.config.ignoredMarkets);
        markets = StrategyUtils.filterByAuthorizedMarkets(markets, this.strategyDetails.config.authorizedMarkets);
        markets = StrategyUtils.filterByAmountPrecision(markets, 1); // when trading with big price amounts, this can be removed
        await this.fetchCandlesticks(markets, candleStickInterval, this.CANDLE_STICKS_TO_FETCH)
            .catch(e => Promise.reject(e));
        StrategyUtils.computeCandlestickPercentVariations(markets);
        return Promise.resolve(markets);
    }

    /**
     * Fetches wallet information and refills it if needed
     */
    private async prepareWallet(market: Market, authorizedCurrencies: Array<Currency>): Promise<void> {
        this.initialWalletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        this.state.initialWalletBalance = JSON.stringify(Array.from(this.initialWalletBalance!.entries()));
        log.info("Initial wallet balance : %O", this.initialWalletBalance);
        await this.handleOriginAssetRefill(market, this.initialWalletBalance?.get(market.originAsset))
            .catch(e => Promise.reject(e));
        this.refilledWalletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        this.state.refilledWalletBalance = JSON.stringify(Array.from(this.refilledWalletBalance!.entries()));
        log.info("Updated wallet balance after refill : %O", this.refilledWalletBalance);
        return Promise.resolve();
    }

    /**
     * Finds candlesticks for each market.
     */
    private async fetchCandlesticks(markets: Array<Market>, interval: string, numberOfCandleSticks: number): Promise<void> {
        log.info(`Fetching candlesticks for ${markets.length} markets`);
        const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_grey);
        progress.start(markets.length, 0);
        let index = 0;
        const oneThird = ~~(markets.length/3);
        async function firstHalf(apiConnector: BinanceConnector) {
            for (let i = 0; i < oneThird; i++) {
                const market = markets[i];
                progress.update(++index);
                market.candleSticks = await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 3);
            }
        }
        async function secondHalf(apiConnector: BinanceConnector) {
            for (let i = oneThird; i < oneThird * 2; i++) {
                const market = markets[i];
                progress.update(++index);
                market.candleSticks = await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 3);
            }
        }
        async function thirdHalf(apiConnector: BinanceConnector) {
            for (let j = oneThird * 2; j < markets.length; j++) {
                const market = markets[j];
                progress.update(++index);
                market.candleSticks = await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 3);
            }
        }
        // if this method ends faster than around 6 seconds then we reach a limit for binance API calls per minute
        await Promise.all([firstHalf(this.apiConnector),
            secondHalf(this.apiConnector),
            thirdHalf(this.apiConnector),
            GlobalUtils.sleep(6)]);
        progress.stop();
    }

    /**
     * Buys an x amount of origin asset.
     * Example : to trade 10€ on the market with symbol BNB/BTC without having
     * 10€ worth of BTC, one has to buy the needed amount of BTC before continuing.
     */
    private async handleOriginAssetRefill(market: Market, availableAmountOfOriginAsset?: number): Promise<void> {
        if (availableAmountOfOriginAsset === undefined) {
            return Promise.reject(`The available amount of ${market.originAsset} could not be determined`);
        }
        if (availableAmountOfOriginAsset === 0 && market.originAsset === Currency.EUR) {
            return Promise.reject(`You have 0 EUR :(`);
        }

        // We suppose that before starting the trading, we only have EUR in the wallet
        // and when we finish the trading, we convert everything back to EUR.
        // Below we are going to convert the needed amount of EUR into `originAsset`.
        if (market.originAsset !== Currency.EUR) {
            const unitPriceInEur = await this.apiConnector.getUnitPrice(Currency.EUR, market.originAsset, true)
                .catch(e => Promise.reject(e));
            const amountToBuy = Math.max(market.minNotional ? market.minNotional + (market.minNotional * 0.01) :
                -1, this.strategyDetails.config.maxMoneyToTrade/unitPriceInEur);
            const order = await this.apiConnector.createMarketOrder(Currency.EUR,
                market.originAsset, "buy", amountToBuy, true)
                .catch(e => Promise.reject(e));
            this.marketUnitPriceOfOriginAssetInEur = order.average!;
            this.state.initialUnitPriceOnYXMarket = order.average;
            this.state.investedAmountOfEuro = order.amountOfOriginAsset;
            this.state.amountOfYBought = order.filled;
        }
        return Promise.resolve();
    }

    getTradingState(): TradingState {
        return this.state;
    }
}

export type MountainSeekerConfig = BaseStrategyConfig & {
    /** The maximum amount of money (in EUR) that a strategy is allowed to use for trading. */
    maxMoneyToTrade: number;

    /** Markets that will be filtered out and never be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    ignoredMarkets?: Array<string>;

    /** Markets that can be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    authorizedMarkets?: Array<string>;

    /** The currencies that the strategy is allowed to use for trading.
     * Example: we want to buy on GAS/BTC market but we only have EUR in the wallet.
     * Therefore, the strategy will convert EUR to BTC */
    authorizedCurrencies?: Array<Currency>;

    /** Used to keep only those markets that have at least this number of percentage variation
     * in last 24 hours. Can be negative */
    minimumPercentFor24hVariation?: number;

    /** '1m', '15m', '1h' ... */
    candleStickInterval?: string;

    /** Minimum trading volume of origin asset last 24h*/
    minimumTradingVolumeLast24h?: number;

    /** Seconds to sleep during trading loop while monitoring the price.
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialSecondsToSleepInTheTradingLoop?: number;

    /** Number in percent by which the stop limit price increases.
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialStopLimitPriceIncreaseInTheTradingLoop?: number;

    /** For triggering a new stop limit order if the difference between current
     * unit price and current stop limit price becomes greater than this number (in %).
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialStopLimitPriceTriggerPercent?: number;

    /** Seconds to sleep during trading loop while monitoring the price */
    secondsToSleepInTheTradingLoop?: number;

    /** Number in percent by which the stop limit price increases (e.g. 1 for 1%) */
    stopLimitPriceIncreaseInTheTradingLoop?: number;

    /** For triggering a new stop limit order if the difference between current
     * unit price and current stop limit price becomes greater than this number (in %) */
    stopLimitPriceTriggerPercent?: number;
}