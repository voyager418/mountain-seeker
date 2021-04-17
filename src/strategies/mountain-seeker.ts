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
    private readonly CANDLE_STICKS_TO_FETCH = 20;
    private marketUnitPriceOfOriginAssetInEur = -1;
    private initialWalletBalance?: Map<Currency, number>;
    private refilledWalletBalance?: Map<Currency, number>;

    private state: TradingState = {
        id: uuidv4(),
        stopLimitOrders: []
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
            this.strategyDetails.config.candleStickInterval = "15m";
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.strategyDetails.config.minimumPercentFor24hVariation = 5;
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
            this.strategyDetails.config.initialStopLimitPriceTriggerPercent = 1.1;
        }
        if (!strategyDetails.config.secondsToSleepInTheTradingLoop) {
            this.strategyDetails.config.secondsToSleepInTheTradingLoop = 120;
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
        this.apiConnector.printMarketDetails(market.symbol);
        this.state.marketSymbol = market.symbol;
        this.state.candleSticksPercentageVariations = market.candleSticksPercentageVariations;
        log.info("Found market %O", market.symbol);
        log.debug("Last 3 candlestick's percentage variations with %O interval : %O",
            this.strategyDetails.config.candleStickInterval,
            market.candleSticksPercentageVariations.slice(market.candleSticksPercentageVariations.length - 3));
        // TODO : maybe check if the stop price is < smaller than

        // Prepare wallet
        await this.prepareWallet(market, this.strategyDetails.config.authorizedCurrencies!)
            .catch(e => Promise.reject(e));
        const availableOriginAssetAmount = this.refilledWalletBalance?.get(market.originAsset);
        if (availableOriginAssetAmount === undefined) {
            return Promise.reject("No amount of origin asset in the wallet");
        }

        // Compute the amount of target asset to buy
        const amountToInvest = await this.computeAmountToInvest(market, availableOriginAssetAmount)
            .catch(e => Promise.reject(e));
        let marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset, true)
            .catch(e => Promise.reject(e));
        // TODO : check the minimal amount for BUY order for the particular market
        const amountOfTargetAssetToTrade = amountToInvest/marketUnitPrice;
        log.debug("Preparing to execute the first order to buy %O %O on %O market. (≈ %O %O). Market unit price is %O",
            amountOfTargetAssetToTrade, market.targetAsset, market.symbol, amountToInvest, market.originAsset, marketUnitPrice);

        // First BUY order
        const buyOrder = await this.apiConnector.createMarketOrder(market.originAsset, market.targetAsset,
            "buy", amountOfTargetAssetToTrade, true, 3, amountToInvest).catch(e => Promise.reject(e));
        this.state.firstBuyOrder = buyOrder;
        this.state.amountOfYSpentOnZ = buyOrder.amountOfOriginAssetUsed;

        // First STOP-LIMIT order
        let stopLimitPrice = getCandleStick(market.candleSticks, market.candleSticks.length - 3)[3]; // low of the before before last candlestick
        const targetAssetAmount = await this.apiConnector.getBalanceForCurrency(market.targetAsset).catch(e => Promise.reject(e));
        // TODO : instead of selling everything, sell the amount that was purchased
        //  But in that case, the wallet balance refill must be adapted
        //   (e.g. to always buy the equivalent amount in maxMoneyToTrade of Y instead of verifying the needed
        //    amount based on what is already in the wallet)
        let stopLimitOrder = await this.apiConnector.createStopLimitOrder(market.originAsset, market.targetAsset,
            "sell", targetAssetAmount, stopLimitPrice, stopLimitPrice, 3)
            .catch(e => Promise.reject(e));
        this.state.stopLimitOrders?.push({ ...stopLimitOrder }); // deep copy
        await this.emailService.sendEmail(`Trading started on ${market.symbol}`,
            "Current state : \n" + JSON.stringify(this.state, null, 4));

        // Price monitor loop
        let newStopLimitPrice = buyOrder.average!;
        let secondsToSleepInTheTradingLoop = this.strategyDetails.config.initialSecondsToSleepInTheTradingLoop!;
        let stopLimitPriceTriggerPercent = this.strategyDetails.config.initialStopLimitPriceTriggerPercent!;
        let stopLimitPriceIncreaseInTheTradingLoop = this.strategyDetails.config.initialStopLimitPriceIncreaseInTheTradingLoop!;
        while (stopLimitPrice < marketUnitPrice) {
            await GlobalUtils.sleep(secondsToSleepInTheTradingLoop);
            if((await this.apiConnector.getOrder(stopLimitOrder.externalId, stopLimitOrder.originAsset, stopLimitOrder.targetAsset,
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
                this.state.stopLimitOrders?.push({ ...stopLimitOrder }); // deep copy

                // after the first stop limit order in the loop is done -> parameters are slightly changed
                secondsToSleepInTheTradingLoop = this.strategyDetails.config.secondsToSleepInTheTradingLoop!;
                stopLimitPriceTriggerPercent = this.strategyDetails.config.stopLimitPriceTriggerPercent!;
                stopLimitPriceIncreaseInTheTradingLoop = this.strategyDetails.config.stopLimitPriceIncreaseInTheTradingLoop!;
            }
            this.state.pricePercentChangeOnZY = StrategyUtils.getPercentVariation(buyOrder.average!, newStopLimitPrice);
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
            this.state.retrievedAmountOfEuro = completedOrder!.amountOfOriginAssetUsed!;
        } else {
            const order = await this.apiConnector.createMarketOrder(Currency.EUR, market.originAsset,
                "sell", (this.state.amountOfYBought! - this.state.amountOfYSpentOnZ!) + completedOrder!.amountOfOriginAssetUsed!,
                true).catch(e => Promise.reject(e));
            this.state.retrievedAmountOfEuro = order.average! * order.filled!;
            this.state.endUnitPriceOnYXMarket = order.average;
            this.state.pricePercentChangeOnYX = StrategyUtils.getPercentVariation(this.state.initialUnitPriceOnYXMarket!,
                this.state.endUnitPriceOnYXMarket!);
        }
        this.state.profitEuro = this.state.retrievedAmountOfEuro - this.state.investedAmountOfEuro!;
        this.state.percentChange = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro);
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
    private async computeAmountToInvest(market: Market, availableOriginAssetAmount: number): Promise<number> {
        if (market.originAsset === Currency.EUR) {
            this.state.originAssetIsEur = true;
            return Promise.resolve(Math.min(availableOriginAssetAmount, this.strategyDetails.config.maxMoneyToTrade));
        } else {
            this.state.originAssetIsEur = false;
            return Promise.resolve(Math.min(availableOriginAssetAmount, this.strategyDetails.config.maxMoneyToTrade * (1/this.marketUnitPriceOfOriginAssetInEur)));
        }
    }

    /**
     * Searches the best market based on some criteria.
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private selectMarketForTrading(markets: Array<Market>): Market | undefined {
        const potentialMarkets = [];
        for (const market of markets) {
            const candleStickVariations = market.candleSticksPercentageVariations;
            const currentVariation = getCurrentCandleStickPercentageVariation(market.candleSticksPercentageVariations);

            if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as
                !candleStickVariations.some(variation => variation === 0)) {      // PHB/BTC, QKC/BTC or DF/ETH in Binance
                if (currentVariation >= 0.1 && currentVariation <= 3) { // if current price is increasing
                    const previousVariation = getCandleStickPercentageVariation(market.candleSticksPercentageVariations,
                        market.candleSticksPercentageVariations.length - 2);
                    if (previousVariation >= 9 && previousVariation <= 37) { // if previous price increased between x and y%
                        log.debug(`Potential market : ${JSON.stringify(market)}`);
                        if (!candleStickVariations.slice(candleStickVariations.length - 4, candleStickVariations.length - 2)
                            .some(variation => variation > 6 || variation < -5)) { // if the third and fourth candle stick starting from the end, do not exceed x% and is not less than y%
                            if (market.candleSticks[market.candleSticks.length - 2][4] <= market.candleSticks[market.candleSticks.length - 1][1]) {
                                // if closing price of previous candle stick is <= than the open price of the current one
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
        markets = this.filterByAuthorizedCurrencies(markets);
        markets = this.filterByMinimumTradingVolume(markets);
        markets = this.filterByIgnoredMarkets(markets);
        markets = this.filterByAuthorizedMarkets(markets);
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
        await this.handleOriginAssetRefill(market.originAsset, this.initialWalletBalance?.get(market.originAsset))
            .catch(e => Promise.reject(e));
        this.refilledWalletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        this.state.refilledWalletBalance = JSON.stringify(Array.from(this.refilledWalletBalance!.entries()));
        log.info("Updated wallet balance after refill : %O", this.refilledWalletBalance);
        return Promise.resolve();
    }

    /**
     * @return Markets that can be traded with currencies defined in `MountainSeekerConfig.authorizedCurrencies`
     */
    private filterByAuthorizedCurrencies(markets: Array<Market>): Array<Market> {
        return markets.filter(market =>
            this.strategyDetails.config.authorizedCurrencies && this.strategyDetails.config.authorizedCurrencies
                .some(currency => market.originAsset === currency));
    }

    /**
     * @return Markets that are not defined in {@link MountainSeekerConfig.ignoredMarkets} and that do not have
     * as targetAsset the one that is contained in the ignore markets array.
     *
     * Example: if ignored markets = ["KNC/BTC"]
     * Then this method returns all markets except ["KNC/BTC", "KNC/BNB", ... ]
     */
    private filterByIgnoredMarkets(markets: Array<Market>): Array<Market> {
        if (this.strategyDetails.config.ignoredMarkets && this.strategyDetails.config.ignoredMarkets.length > 0) {
            return markets.filter(market => !this.strategyDetails.config.ignoredMarkets!
                .some(symbol => market.symbol.startsWith(symbol.split('/')[0])));
        }
        return markets;
    }

    /**
     * @return Markets that are defined in {@link MountainSeekerConfig.authorizedMarkets}
     */
    private filterByAuthorizedMarkets(markets: Array<Market>): Array<Market> {
        if (this.strategyDetails.config.authorizedMarkets && this.strategyDetails.config.authorizedMarkets.length > 0) {
            return markets.filter(market => this.strategyDetails.config.authorizedMarkets!
                .some(symbol => symbol === market.symbol));
        }
        return markets;
    }

    /**
     * @return Markets that have traded at least the specified amount of volume or more
     */
    private filterByMinimumTradingVolume(markets: Array<Market>): Array<Market> {
        if (this.strategyDetails.config.minimumTradingVolumeLast24h) {
            return markets.filter(market => market.originAssetVolumeLast24h &&
                (market.originAssetVolumeLast24h >= this.strategyDetails.config.minimumTradingVolumeLast24h!));
        }
        return markets;
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
    private async handleOriginAssetRefill(originAsset: Currency, availableAmountOfOriginAsset?: number): Promise<void> {
        if (availableAmountOfOriginAsset === undefined) {
            return Promise.reject(`The available amount of ${originAsset} could not be determined`);
        }
        if (availableAmountOfOriginAsset === 0 && originAsset === Currency.EUR) {
            return Promise.reject(`You have 0 EUR :(`);
        }

        // We suppose that before starting the trading, we only have EUR in the wallet
        // and when we finish the trading, we convert everything back to EUR.
        // Below we are going to convert the needed amount of EUR into `originAsset`.
        if (originAsset !== Currency.EUR) {
            const unitPriceInEur = await this.apiConnector.getUnitPrice(Currency.EUR, originAsset, true)
                .catch(e => Promise.reject(e));
            const availableAmountOfOriginAssetInEur = unitPriceInEur * availableAmountOfOriginAsset;
            if (availableAmountOfOriginAssetInEur >= this.strategyDetails.config.maxMoneyToTrade) {
                // we have at least `this.strategyDetails.config.maxMoneyToTrade` worth of `originAsset so there's nothing to do
                log.debug(`There is enough amount of origin asset %O`, {
                    originAsset: originAsset,
                    originAssetUnitPriceInEur: unitPriceInEur,
                    availableAmountOfOriginAsset: availableAmountOfOriginAsset,
                    availableAmountOfOriginAssetInEur: availableAmountOfOriginAssetInEur,
                    maxMoneyToTrade: this.strategyDetails.config.maxMoneyToTrade
                });
                this.state.amountOfYBought = 0;
                return Promise.resolve();
            } else {
                const neededAmountInEur = this.strategyDetails.config.maxMoneyToTrade - availableAmountOfOriginAssetInEur;
                log.debug(`There is not enough amount of origin asset %O`, {
                    originAsset: originAsset,
                    originAssetUnitPriceInEur: unitPriceInEur,
                    availableAmountOfOriginAsset: availableAmountOfOriginAsset,
                    availableAmountOfOriginAssetInEur: availableAmountOfOriginAssetInEur,
                    neededAmountInEur: neededAmountInEur,
                    maxMoneyToTrade: this.strategyDetails.config.maxMoneyToTrade
                });
                // if (neededAmountInEur < 11.50) { // each market has a minimal amount to buy, the number set here is arbitrary
                //     log.debug("Skipping refill because the needed amount is too low");
                //     this.marketUnitPriceOfOriginAssetInEur = unitPriceInEur;
                //     this.state.initialUnitPriceOnYXMarket = unitPriceInEur;
                //     return Promise.resolve();
                // }
                const order = await this.apiConnector.createMarketOrder(Currency.EUR,
                    originAsset, "buy", neededAmountInEur/unitPriceInEur, true)
                    .catch(e => Promise.reject(e));
                this.marketUnitPriceOfOriginAssetInEur = order.average!;
                this.state.initialUnitPriceOnYXMarket = order.average;
                this.state.investedAmountOfEuro = order.amountOfOriginAssetUsed;
                this.state.amountOfYBought = order.filled;
            }
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