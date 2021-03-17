import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { Container, Service } from "typedi";
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { TradingState } from "../models/trading-state";
import { v4 as uuidv4 } from 'uuid';
import { BinanceConnector } from "../api-connectors/binance-connector";
import { getCurrentCandleStickPercentageVariation, getPreviousCandleStickPercentageVariation, Market } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import cliProgress from 'cli-progress';
import { OrderType } from "../enums/order-type.enum";
import { OrderAction } from "../enums/order-action.enum";
import { StrategyUtils } from "../utils/strategy-utils";


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
    private readonly CANDLE_STICKS_TO_FETCH = 5;

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
            this.strategyDetails.config.minimumPercentFor24hrVariation = 500;
        }
    }


    public async run(): Promise<TradingState> {
        if (this.strategyDetails.config.candleStickInterval === undefined ||
            this.strategyDetails.config.minimumPercentFor24hrVariation === undefined ||
            this.strategyDetails.config.authorizedCurrencies === undefined ||
            this.strategyDetails.config.maxMoneyToTrade === undefined) {
            return Promise.reject("Missing a config parameter");
        }

        // Preparing data
        let markets: Array<Market> = await this.apiConnector.getMarketsBy24hrVariation(this.strategyDetails.config.minimumPercentFor24hrVariation)
            .catch(e => Promise.reject(e));
        markets = this.filterByAuthorizedCurrencies(markets);
        await this.fetchCandlesticks(markets, this.strategyDetails.config.candleStickInterval, this.CANDLE_STICKS_TO_FETCH)
            .catch(e => Promise.reject(e));
        StrategyUtils.computeCandlestickPercentVariations(markets);
        // const market = this.selectMarketForTrading(markets);
        const market = await this.apiConnector.getTestMarket().catch(e => Promise.reject(e));

        if (!market) {
            log.info("No market was found");
            return Promise.resolve(this.state);
        }
        log.info("Found market %O", market);

        // Preparing wallet
        this.state.walletBalance = await this.apiConnector.getBalance(this.strategyDetails.config.authorizedCurrencies)
            .catch(e => Promise.reject(e));
        log.info("Current wallet balance : %O", this.state.walletBalance);
        await this.handleOriginAssetRefill(market.originAsset, this.state.walletBalance?.get(market.originAsset))
            .catch(e => Promise.reject(e));
        this.state.walletBalance = await this.apiConnector.getBalance(this.strategyDetails.config.authorizedCurrencies)
            .catch(e => Promise.reject(e));
        log.info("Updated wallet balance after refill : %O", this.state.walletBalance);
        const availableOriginAssetAmount = this.state.walletBalance?.get(market.originAsset);
        if (availableOriginAssetAmount === undefined) {
            return Promise.reject();
        }

        // Computing the amount to buy
        let marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset)
            .catch(e => Promise.reject(e));
        let amountOfTargetAssetToBuy;
        let amountOfEurToInvest
        if (market.originAsset === Currency.EUR) {
            amountOfEurToInvest = Math.min(availableOriginAssetAmount, this.strategyDetails.config.maxMoneyToTrade);
            amountOfTargetAssetToBuy = (1/marketUnitPrice) * amountOfEurToInvest;
        } else {
            const marketUnitPriceOfOriginAssetInEur = await this.apiConnector.getUnitPrice(Currency.EUR, market.originAsset)
                .catch(e => Promise.reject(e));
            const availableOriginAssetAmountInEur = marketUnitPriceOfOriginAssetInEur * availableOriginAssetAmount;
            amountOfEurToInvest = Math.min(availableOriginAssetAmountInEur, this.strategyDetails.config.maxMoneyToTrade);
            amountOfTargetAssetToBuy = (1/marketUnitPrice) * amountOfEurToInvest;
        }

        // First order
        log.debug("Preparing to execute the first %O order to buy %O %O on %O market. (≈ %O EUR)",
            OrderAction.BUY, amountOfTargetAssetToBuy, market.targetAsset, market.symbol, amountOfEurToInvest);
        await this.apiConnector.createOrder({
            id: uuidv4(),
            action: OrderAction.BUY,
            amount: amountOfTargetAssetToBuy,
            originAsset: market.originAsset,
            targetAsset: market.targetAsset,
            type: OrderType.MARKET
        }).catch(e => Promise.reject(e));

        // Price monitor loop






        log.info("Trading has finished", this.state)
        return Promise.resolve(this.state);
    }



    /**
     * Searches the best market based on some criteria.
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private selectMarketForTrading(markets: Array<Market>): Market | undefined {
        // TODO maybe discard markets such as DF/ETH
        const potentialMarkets = [];
        for (const market of markets) {
            const candleStickVariations = market.candleSticksPercentageVariations;
            if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as PHB/BTC or QKC/BTC in Binance
                getCurrentCandleStickPercentageVariation(market.candleSticksPercentageVariations) > 0.1) { // if current price is increasing
                const previousVariation = getPreviousCandleStickPercentageVariation(market.candleSticksPercentageVariations);
                if (previousVariation >= 1 && previousVariation <= 40) { // if previous price increased between x and y%
                    // const previousCandleStick = getPreviousCandleStick(market.candleSticks);
                    // if the price variation of the previous candlestick between it's highest and closing price
                    // does not exceed x%
                    // if (MountainSeeker.computePercentVariation(previousCandleStick[4], previousCandleStick[2]) <= 2) {
                    if (!candleStickVariations.slice(1, this.CANDLE_STICKS_TO_FETCH - 2)
                        .some((variation: number) => variation > 10)) { // if the third and fourth candle stick starting from the end, do not exceed x%
                        // TODO maybe add '|| variation < -y in the if
                        potentialMarkets.push(market);
                    }
                    // }
                }
            }
        }

        if (potentialMarkets.length > 0) {
            // return the market with the highest previous candlestick % variation
            return potentialMarkets.reduce((prev, current) =>
                ((getPreviousCandleStickPercentageVariation(prev.candleSticksPercentageVariations) >
                    getPreviousCandleStickPercentageVariation(current.candleSticksPercentageVariations)) ? prev : current));
        }

        // TODO : if nothing was found, maybe search markets that have >= e.g. 100% 24h variation
        //  and have increasing candlesticks
        return undefined;
    }


    /**
     * @return Markets that can be traded with currencies defined in `MountainSeekerConfig.authorizedCurrencies`
     */
    private filterByAuthorizedCurrencies(markets: Array<Market>): Array<Market> {
        return markets.filter(market =>
            this.strategyDetails.config.authorizedCurrencies &&
            this.strategyDetails.config.authorizedCurrencies
                .some(currency => market.originAsset === currency));
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
                await this.apiConnector.createOrder({
                    id: uuidv4(),
                    action: OrderAction.BUY,
                    type: OrderType.MARKET,
                    originAsset: Currency.EUR,
                    targetAsset: originAsset,
                    amount: (1/unitPriceInEur) * neededAmountInEur
                }).catch(e => Promise.reject(e));
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