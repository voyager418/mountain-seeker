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


/**
 * The general goal of this strategy is to select and buy an action
 * that is, and recently was, harshly rising in price.
 * Then sell it when the price starts to decrease.
 */
@Service({ transient: true })
export class MountainSeeker implements BaseStrategy {
    private readonly IS_SIMULATION = false; // IF false THEN REAL ORDERS WILL BE MADE !!
    private readonly strategyDetails;
    private readonly account: Account;
    private apiConnector: BinanceConnector;
    private emailService: EmailService;
    private readonly CANDLE_STICKS_TO_FETCH = 20;
    private marketUnitPriceOfOriginAssetInEur = -1;

    private state: TradingState = {
        id: uuidv4(),
        stopLimitOrders: []
    };

    constructor(account: Account, strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        this.account = account;
        this.strategyDetails = strategyDetails;
        Container.set("BINANCE_API_KEY", account.apiKey);
        Container.set("BINANCE_API_SECRET", account.apiSecret);
        Container.set("IS_SIMULATION", this.IS_SIMULATION);
        this.apiConnector = Container.get(BinanceConnector);
        this.emailService = Container.get(EmailService);
        this.initDefaultConfig(strategyDetails);
        this.state.config = strategyDetails;
        if (!this.IS_SIMULATION) {
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
        if (!strategyDetails.config.minimumPercentFor24hrVariation) {
            this.strategyDetails.config.minimumPercentFor24hrVariation = 0;
        }
        if (!strategyDetails.config.authorizedMarkets) {
            this.strategyDetails.config.authorizedMarkets = [];
        }
    }


    public async run(): Promise<TradingState> {
        // Fetch data and select market
        const markets: Array<Market> = await this.fetchMarkets(this.strategyDetails.config.minimumPercentFor24hrVariation!,
            this.strategyDetails.config.candleStickInterval!)
            .catch(e => Promise.reject(e));
        const market = this.selectMarketForTrading(markets);
        // const market = markets[0]; // attention if the stop price is bigger than current price, it will not work

        if (!market) {
            log.info("No market was found");
            return Promise.resolve(this.state);
        }
        this.state.market = market;
        await this.emailService.sendEmail(`Trading started on market ${market.symbol}`,
            JSON.stringify(market, null, 4));
        log.info("Found market %O", market.symbol);
        log.debug("Last 3 candlesticks : %O",
            market.candleSticks.slice(market.candleSticks.length - 3));
        log.debug("Last 3 candlestick's percentage variations with %O interval : %O",
            this.strategyDetails.config.candleStickInterval,
            market.candleSticksPercentageVariations.slice(market.candleSticksPercentageVariations.length - 3));
        // TODO : maybe check if the stop price is < smaller than

        // Prepare wallet
        await this.prepareWallet(market, this.strategyDetails.config.authorizedCurrencies!)
            .catch(e => Promise.reject(e));
        const availableOriginAssetAmount = this.state.refilledWalletBalance?.get(market.originAsset);
        if (availableOriginAssetAmount === undefined) {
            return Promise.reject("No amount of origin asset in the wallet");
        }

        // Compute the amount of target asset to buy
        const amountToInvest = await this.computeAmountToInvest(market, availableOriginAssetAmount)
            .catch(e => Promise.reject(e));
        this.state.investedAmountOfEuro = amountToInvest;
        let marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset)
            .catch(e => Promise.reject(e));
        // TODO : check the minimal amount for BUY order for the particular market
        const amountOfTargetAssetToTrade = amountToInvest/marketUnitPrice;
        log.debug("Preparing to execute the first order to buy %O %O on %O market. (≈ %O %O). Market unit price is %O",
            amountOfTargetAssetToTrade, market.targetAsset, market.symbol, amountToInvest, market.originAsset, marketUnitPrice);

        // First BUY order
        const buyOrder = await this.apiConnector.createMarketOrder(market.originAsset, market.targetAsset,
            "buy", amountOfTargetAssetToTrade, true, 3).catch(e => Promise.reject(e));
        this.state.firstBuyOrder = buyOrder;

        // First STOP-LIMIT order
        const sellPrice = getCandleStick(market.candleSticks, market.candleSticks.length - 3)[3]; // low of the before before last candlestick
        const targetAssetAmount = await this.apiConnector.getBalanceForCurrency(market.targetAsset)
            .catch(e => Promise.reject(e));
        // TODO : instead of selling everything, sell the amount that was purchased
        //  (= targetAssetAmount - commision or previous balance - targetAssetAmount)
        let stopLimitOrder = await this.apiConnector.createStopLimitOrder(market.originAsset, market.targetAsset,
            "sell", targetAssetAmount, sellPrice, sellPrice, false, 3)
            .catch(e => Promise.reject(e));
        this.state.stopLimitOrders?.push({ ...stopLimitOrder }); // deep copy

        // Price monitor loop
        let newSellPrice = buyOrder.average!;
        let sellPriceUpdated = false;
        while (sellPrice < marketUnitPrice) {
            await GlobalUtils.sleep(180);
            marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset)
                .catch(e => log.error(e));

            if (StrategyUtils.getPercentVariation(newSellPrice, marketUnitPrice) >= 2.5) {
            // if (StrategyUtils.getPercentVariation(newSellPrice, marketUnitPrice) >= 0.3) {
                // cancel the previous stop limit order
                await this.apiConnector.cancelOrder(stopLimitOrder.externalId, stopLimitOrder.id,
                    market.originAsset, market.targetAsset).catch(e => Promise.reject(e));

                // compute new stop price
                newSellPrice = newSellPrice + (newSellPrice * 0.01); // increasing by 1%
                // newSellPrice = newSellPrice + (newSellPrice * 0.001); // 0.001

                // create new stop limit order
                stopLimitOrder = await this.apiConnector.createStopLimitOrder(market.originAsset, market.targetAsset,
                    "sell", targetAssetAmount, newSellPrice, newSellPrice, false, 3)
                    .catch(e => Promise.reject(e));
                this.state.stopLimitOrders?.push({ ...stopLimitOrder }); // deep copy
                sellPriceUpdated = true;
            } else if (sellPriceUpdated && StrategyUtils.getPercentVariation(newSellPrice, marketUnitPrice) <= 0) {
                break;
            }
            log.info(`Buy (${buyOrder.average}), current (${(marketUnitPrice)
                .toFixed(3)}) change % : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                marketUnitPrice)).toFixed(3)}% | Sell price : ${(newSellPrice)
                .toFixed(3)} | Profit : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                newSellPrice)).toFixed(3)}%`);
        }

        await this.handleTradeEnd(market, stopLimitOrder).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        log.info(`Trading has finished ${JSON.stringify(this.state, null, 4)}`);
        return Promise.resolve(this.state);
    }

    /**
     * If the initial selected market was not accepting EUR (e.g. "CAKE/BNB")
     * then the full amount of origin asset is traded for EUR (e.g. => BNB is sold on "BNB/EUR" market)
     */
    private async handleTradeEnd(market: Market, lastStopLimitOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        // let completedOrder = await this.apiConnector.waitForOrderCompletion(lastStopLimitOrder, originAsset, targetAsset, 3).catch(e => Promise.reject(e));
        let completedOrder = await this.apiConnector.waitForOrderCompletion(lastStopLimitOrder, market.originAsset,
            market.targetAsset, 3).catch(e => Promise.reject(e));
        if (!completedOrder) { // stop limit order took too much => use a MARKET order
            completedOrder = await this.apiConnector.createMarketOrder(Currency.EUR, market.originAsset,
                "sell", lastStopLimitOrder.amountOfTargetAsset, true).catch(e => Promise.reject(e));
        }
        if (market.originAsset === Currency.EUR) {
            this.state.retrievedAmountOfEuro = completedOrder!.amountOfOriginAssetUsed!;
        } else {
            const order = await this.apiConnector.createMarketOrder(Currency.EUR, market.originAsset,
                "sell", completedOrder!.filled * completedOrder!.average!, true).catch(e => Promise.reject(e));
            this.state.retrievedAmountOfEuro = order.average! * order.filled!;
            this.state.endUnitPriceOnYXMarket = order.average;
            this.state.percentChangeOnYX = StrategyUtils.getPercentVariation(this.state.initialUnitPriceOnYXMarket!,
                this.state.endUnitPriceOnYXMarket!);
        }
        this.state.profitEuro = this.state.retrievedAmountOfEuro - this.state.investedAmountOfEuro!;
        this.state.percentChange = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro);
        await this.emailService.sendEmail("Trading has finished", JSON.stringify(this.state, null, 4));
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
            if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as
                !candleStickVariations.some(variation => variation === 0) &&      // PHB/BTC, QKC/BTC or DF/ETH in Binance
                getCurrentCandleStickPercentageVariation(market.candleSticksPercentageVariations) > 0.1 && // if current price is increasing
                getCurrentCandleStickPercentageVariation(market.candleSticksPercentageVariations) <= 5) {
                const previousVariation = getCandleStickPercentageVariation(market.candleSticksPercentageVariations,
                    market.candleSticksPercentageVariations.length - 2);
                if (previousVariation >= 8 && previousVariation <= 40) { // if previous price increased between x and y%
                    if (!candleStickVariations.slice(candleStickVariations.length - 4, candleStickVariations.length - 2)
                        .some(variation => variation > 10 || variation < -5)) {
                        // if the third and fourth candle stick starting from the end, do not exceed x% and is not less than y%
                        potentialMarkets.push(market);
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

        // TODO : if nothing was found, maybe search markets that have >= e.g. 100% 24h variation
        //  and have increasing candlesticks
        return undefined;
    }


    /**
     * @return All potentially interesting markets
     */
    private async fetchMarkets(minimumPercentVariation: number, candleStickInterval: string): Promise<Array<Market>> {
        let markets: Array<Market> = await this.apiConnector.getMarketsBy24hrVariation(minimumPercentVariation)
            .catch(e => Promise.reject(e));
        markets = this.filterByAuthorizedCurrencies(markets);
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
        this.state.initialWalletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        log.info("Initial wallet balance : %O", this.state.initialWalletBalance);
        await this.handleOriginAssetRefill(market.originAsset, this.state.initialWalletBalance?.get(market.originAsset))
            .catch(e => Promise.reject(e));
        this.state.refilledWalletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        log.info("Updated wallet balance after refill : %O", this.state.refilledWalletBalance);
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
     * @return Markets that are not defined in {@link MountainSeekerConfig.ignoredMarkets}
     */
    private filterByIgnoredMarkets(markets: Array<Market>): Array<Market> {
        if (this.strategyDetails.config.ignoredMarkets && this.strategyDetails.config.ignoredMarkets.length > 0) {
            return markets.filter(market =>
                !this.strategyDetails.config.ignoredMarkets!
                    .some(symbol => symbol === market.symbol));
        }
        return markets;
    }

    /**
     * @return Markets that are defined in {@link MountainSeekerConfig.authorizedMarkets}
     */
    private filterByAuthorizedMarkets(markets: Array<Market>): Array<Market> {
        if (this.strategyDetails.config.authorizedMarkets && this.strategyDetails.config.authorizedMarkets.length > 0) {
            return markets.filter(market =>
                this.strategyDetails.config.authorizedMarkets!
                    .some(symbol => symbol === market.symbol));
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
        for (const market of markets) {
            progress.update(++index);
            market.candleSticks = await this.apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks);
        }
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
            const unitPriceInEur = await this.apiConnector.getUnitPrice(Currency.EUR, originAsset)
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
                if (neededAmountInEur < 11.50) { // each market has a minimal amount to buy, the number set here is arbitrary
                    log.debug("Skipping refill because the needed amount is too low");
                    this.marketUnitPriceOfOriginAssetInEur = unitPriceInEur;
                    this.state.initialUnitPriceOnYXMarket = unitPriceInEur;
                    return Promise.resolve();
                }
                const order = await this.apiConnector.createMarketOrder(Currency.EUR,
                    originAsset, "buy", neededAmountInEur/unitPriceInEur, true)
                    .catch(e => Promise.reject(e));
                this.marketUnitPriceOfOriginAssetInEur = order.average!;
                this.state.initialUnitPriceOnYXMarket = order.average;
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
    minimumPercentFor24hrVariation?: number;

    /** '1m', '15m', '1h' ... */
    candleStickInterval?: string;
}