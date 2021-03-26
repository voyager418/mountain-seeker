import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { Container, Service } from "typedi";
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { TradingState } from "../models/trading-state";
import { v4 as uuidv4 } from 'uuid';
import { BinanceConnector } from "../api-connectors/binance-connector";
import {
    getCurrentCandleStickPercentageVariation,
    Market,
    getCandleStickPercentageVariation, getCandleStick
} from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import cliProgress from 'cli-progress';
import { OrderType } from "../enums/order-type.enum";
import { OrderAction } from "../enums/order-action.enum";
import { StrategyUtils } from "../utils/strategy-utils";
import { GlobalUtils } from "../utils/global-utils";


/**
 * The general goal of this strategy is to select and buy an action
 * that is, and recently was, harshly rising in price.
 * Then sell it when the price starts to decrease.
 */
@Service({ transient: true })
export class MountainSeeker implements BaseStrategy {
    private readonly IS_SIMULATION = true; // IF false THEN REAL ORDERS WILL BE MADE !!
    private readonly strategyDetails;
    private readonly account: Account;
    private apiConnector: BinanceConnector;
    private readonly CANDLE_STICKS_TO_FETCH = 20;

    private state: TradingState = {
        id: uuidv4(),
        profitPercent: 0
    };

    constructor(account: Account, strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        this.account = account;
        this.strategyDetails = strategyDetails;
        Container.set("BINANCE_API_KEY", account.apiKey);
        Container.set("BINANCE_API_SECRET", account.apiSecret);
        Container.set("IS_SIMULATION", this.IS_SIMULATION);
        this.apiConnector = Container.get(BinanceConnector);
        this.initDefaultConfig(strategyDetails);
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
            this.strategyDetails.config.minimumPercentFor24hrVariation = 100;
        }
    }


    public async run(): Promise<TradingState> {
        // Fetch data and select market
        const markets: Array<Market> = await this.fetchMarkets(this.strategyDetails.config.minimumPercentFor24hrVariation!,
            this.strategyDetails.config.candleStickInterval!)
            .catch(e => Promise.reject(e));
        const market = this.selectMarketForTrading(markets);
        // const market = await this.apiConnector.getTestMarket("BNB/EUR").catch(e => Promise.reject(e));

        if (!market) {
            log.info("No market was found");
            return Promise.resolve(this.state);
        }
        log.info("Found market %O", market.symbol);
        log.debug("Last 3 candlesticks : %O",
            market.candleSticks.slice(market.candleSticks.length - 3));
        log.debug("Last 3 candlestick's percentage variations with %O interval : %O",
            this.strategyDetails.config.candleStickInterval,
            market.candleSticksPercentageVariations.slice(market.candleSticksPercentageVariations.length - 3));

        // Prepare wallet
        await this.prepareWallet(market, this.strategyDetails.config.authorizedCurrencies!)
            .catch(e => Promise.reject(e));
        const availableOriginAssetAmount = this.state.walletBalance?.get(market.originAsset);
        if (availableOriginAssetAmount === undefined) {
            return Promise.reject("No amount of origin asset in the wallet");
        }

        // Compute the amount of target asset to buy
        const amountInEurToInvest = await this.computeAmountInEuroToInvest(market, availableOriginAssetAmount)
            .catch(e => Promise.reject(e));
        let marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset)
            .catch(e => Promise.reject(e));
        // TODO : check the minimal amout of BUY order for the particular market
        const amountOfTargetAssetToTrade = (1/marketUnitPrice) * amountInEurToInvest;
        log.debug("Preparing to execute the first %O order to buy %O %O on %O market. (≈ %O EUR)",
            OrderAction.BUY, amountOfTargetAssetToTrade, market.targetAsset, market.symbol, amountInEurToInvest);

        // First BUY order
        const buyOrder = await this.apiConnector.createOrder({
            id: uuidv4(),
            action: OrderAction.BUY,
            amount: amountOfTargetAssetToTrade,
            originAsset: market.originAsset,
            targetAsset: market.targetAsset,
            type: OrderType.MARKET
        }, true).catch(e => Promise.reject(e));

        // First STOP-LIMIT order
        const sellPrice = getCandleStick(market.candleSticks, market.candleSticks.length - 3)[1]; // the open price of the before before last candlestick
        let stopLimitOrder = await this.apiConnector.createOrder({
            id: uuidv4(),
            action: OrderAction.SELL,
            amount: amountOfTargetAssetToTrade,
            limitPrice: sellPrice,
            stopPrice: sellPrice,
            originAsset: market.originAsset,
            targetAsset: market.targetAsset,
            type: OrderType.STOP_LOSS_LIMIT
        }, false).catch(e => Promise.reject(e));

        // Price monitor loop
        let newSellPrice = buyOrder.average!;
        while (sellPrice < marketUnitPrice || newSellPrice < marketUnitPrice) {
            await GlobalUtils.sleep(3);
            marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset);

            if (StrategyUtils.getPercentVariation(newSellPrice, marketUnitPrice) >= 3) {
                // cancel the previous stop limit order
                await this.apiConnector.cancelOrder(
                    stopLimitOrder.externalId!,
                    `${stopLimitOrder.targetAsset}/${stopLimitOrder.originAsset}`,
                    stopLimitOrder.id).catch(e => Promise.reject(e));

                // compute new stop price
                newSellPrice = newSellPrice + (newSellPrice * 0.015);

                // create new stop limit order
                stopLimitOrder = await this.apiConnector.createOrder({
                    id: uuidv4(),
                    action: OrderAction.SELL,
                    amount: amountOfTargetAssetToTrade,
                    limitPrice: newSellPrice,
                    stopPrice: newSellPrice,
                    originAsset: market.originAsset,
                    targetAsset: market.targetAsset,
                    type: OrderType.STOP_LOSS_LIMIT
                }, false).catch(e => Promise.reject(e));
            }
            log.debug(`Buy (${buyOrder.average}) vs current (${(marketUnitPrice).toFixed(2)}) price : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                marketUnitPrice)).toFixed(2)}% | Sell price : ${(newSellPrice).toFixed(2)} | Profit : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                newSellPrice)).toFixed(2)}%`);
        }


        log.info("Trading has finished", this.state)
        return Promise.resolve(this.state);
    }


    /**
     * @return The amount of EUR that will be invested
     */
    private async computeAmountInEuroToInvest(market: Market, availableOriginAssetAmount: number): Promise<number> {
        if (market.originAsset === Currency.EUR) {
            return Promise.resolve(Math.min(availableOriginAssetAmount, this.strategyDetails.config.maxMoneyToTrade));
        } else {
            const marketUnitPriceOfOriginAssetInEur = await this.apiConnector.getUnitPrice(Currency.EUR, market.originAsset)
                .catch(e => Promise.reject(e));
            const availableOriginAssetAmountInEur = marketUnitPriceOfOriginAssetInEur * availableOriginAssetAmount;
            return Promise.resolve(Math.min(availableOriginAssetAmountInEur, this.strategyDetails.config.maxMoneyToTrade));
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
                getCurrentCandleStickPercentageVariation(market.candleSticksPercentageVariations) > 0.1) { // if current price is increasing
                const previousVariation = getCandleStickPercentageVariation(market.candleSticksPercentageVariations,
                    market.candleSticksPercentageVariations.length - 2);
                if (previousVariation >= 9 && previousVariation <= 40) { // if previous price increased between x and y%
                    if (!candleStickVariations.slice(1, 3)
                        .some((variation: number) => variation > 10)) { // if the third and fourth candle stick starting from the end, do not exceed x%
                        // TODO maybe add '|| variation < -y in the if
                        potentialMarkets.push(market);
                    }
                }
            }
        }

        if (potentialMarkets.length > 0) {
            // return the market with the highest current candlestick % variation
            return potentialMarkets.reduce((prev, current) =>
                ((getCurrentCandleStickPercentageVariation(prev.candleSticksPercentageVariations) >
                    getCurrentCandleStickPercentageVariation(current.candleSticksPercentageVariations)) ? prev : current));
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
        console.log(markets);
        await this.fetchCandlesticks(markets, candleStickInterval, this.CANDLE_STICKS_TO_FETCH)
            .catch(e => Promise.reject(e));
        StrategyUtils.computeCandlestickPercentVariations(markets);
        return Promise.resolve(markets);
    }

    /**
     * Fetches wallet information and refills it if needed
     */
    private async prepareWallet(market: Market, authorizedCurrencies: Array<Currency>): Promise<void> {
        this.state.walletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        log.info("Current wallet balance : %O", this.state.walletBalance);
        await this.handleOriginAssetRefill(market.originAsset, this.state.walletBalance?.get(market.originAsset))
            .catch(e => Promise.reject(e));
        this.state.walletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        log.info("Updated wallet balance after refill : %O", this.state.walletBalance);
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
     * @return Markets that are not defined in `MountainSeekerConfig.ignoredMarkets`
     */
    private filterByIgnoredMarkets(markets: Array<Market>): Array<Market> {
        return markets.filter(market =>
            this.strategyDetails.config.ignoredMarkets && !this.strategyDetails.config.ignoredMarkets
                .some(symbol => symbol === market.symbol));
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
                // TODO : before creating the order, check the minimal BUY order price
                await this.apiConnector.createOrder({
                    id: uuidv4(),
                    action: OrderAction.BUY,
                    type: OrderType.MARKET,
                    originAsset: Currency.EUR,
                    targetAsset: originAsset,
                    amount: (1/unitPriceInEur) * neededAmountInEur
                }, true).catch(e => Promise.reject(e));
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
     * It is an array of market symbols, for example : ["BNB/EUR"] */
    ignoredMarkets?: Array<string>;

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