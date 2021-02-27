import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { Container, Service } from "typedi";
import { StrategyDetails, BaseStrategyConfig } from "../models/strategy-details";
import { TradingState } from "../models/trading-state";
import { v4 as uuidv4 } from 'uuid';
import { BinanceService } from "../api-connectors/binance-service";
import {
    getCurrentCandleStickPercentageVariation,
    getPreviousCandleStick,
    getPreviousCandleStickPercentageVariation,
    Market
} from "../models/market";


/**
 * The general goal of this strategy is to select and buy an action
 * that is, and recently was, harshly rising in price.
 * Then sell it when the price starts to decrease.
 */
@Service({ transient: true })
export class MountainSeeker implements BaseStrategy {
    private readonly strategyDetails;
    private readonly account: Account;
    private apiConnector: BinanceService; // TODO : this should be dynamic

    private state: TradingState = { // TODO : the state should be initialised
        id: uuidv4(),
        walletBalance: 100,
        profitPercent: 0
    };

    constructor(account: Account,
        strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        this.account = account;
        this.strategyDetails = strategyDetails;
        this.apiConnector = Container.get(BinanceService);
        this.initDefaultConfig(strategyDetails);
    }

    /**
     * Sets default config values
     * // TODO : there might be a better way to set default parameters
     */
    private initDefaultConfig(strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        if (!strategyDetails.config.authorizedCurrencies) {
            this.strategyDetails.config.authorizedCurrencies = ["EUR", "BTC", "BNB"];
        }
        if (!strategyDetails.config.candleStickInterval) {
            this.strategyDetails.config.candleStickInterval = "15m";
        }
        if (!strategyDetails.config.candleStickNumber) {
            this.strategyDetails.config.candleStickNumber = 4;
        }
        if (!strategyDetails.config.minimumPercentFor24hrVariation) {
            this.strategyDetails.config.minimumPercentFor24hrVariation = 0;
        }
    }

    public async run(): Promise<TradingState> {
        if (this.strategyDetails.config.candleStickInterval === undefined ||
            this.strategyDetails.config.minimumPercentFor24hrVariation === undefined ||
            this.strategyDetails.config.candleStickNumber === undefined ||
            this.strategyDetails.config.authorizedCurrencies === undefined) {
            return Promise.reject("Missing config parameter");
        }
        log.info("Trading has started", this.state);

        let markets: Array<Market> = await this.apiConnector.getMarketsBy24hrVariation(this.strategyDetails.config.minimumPercentFor24hrVariation);
        markets = this.filterByAuthorizedCurrencies(markets);
        await this.computeCandlesticks(markets, this.strategyDetails.config.candleStickInterval, this.strategyDetails.config.candleStickNumber);
        MountainSeeker.computeCandlestickPercentVariations(markets);
        const market = this.selectMarketForTrading(markets);


        console.log(market);
        log.info("Trading has finished", this.state)
        // this.apiConnector.test();
        return Promise.resolve(this.state);
    }


    /**
     * Searches the best market based on some criteria.
     * @returns A market which will be used for trading. Or `undefined` if not found
     */
    private selectMarketForTrading(markets: Array<Market>): Market | undefined {
        const potentialMarkets = [];
        for (const market of markets) {
            const candleStickVariations = market.candleSticksPercentageVariations;
            if (!MountainSeeker.arrayHasDuplicatedNumber(candleStickVariations) && // to discard strange graphs as PHB/BTC or QKC/BTC in Binance
                getCurrentCandleStickPercentageVariation(market.candleSticksPercentageVariations) > 0) { // if current price is increasing
                const previousVariation = getPreviousCandleStickPercentageVariation(market.candleSticksPercentageVariations);
                if (previousVariation >= 15 && previousVariation <= 40) { // if previous price increased between x and y%
                    const previousCandleStick = getPreviousCandleStick(market.candleSticks);
                    // if the price variation of the previous candlestick between it's highest and closing price
                    // does not exceed x%
                    if (MountainSeeker.computePercentVariation(previousCandleStick[4], previousCandleStick[2]) <= 2) {
                        if (!candleStickVariations.slice(0, candleStickVariations.length - 2)
                            .some((variation: number) => variation > 5)) { // if all variations, except the last 2, do not exceed x%
                            // TODO maybe add something like '|| variation < -10' in the if
                            potentialMarkets.push(market);
                        }
                    }
                }
            }
        }

        if (potentialMarkets.length > 0) {
            // return the market with the highest previous candlestick % variation
            return potentialMarkets.reduce((prev, current) =>
                ((getPreviousCandleStickPercentageVariation(prev.candleSticksPercentageVariations) >
                    getPreviousCandleStickPercentageVariation(current.candleSticksPercentageVariations)) ? prev : current));
        }
        return undefined;
    }


    /**
     * @returns Markets that can be traded with currencies defined in `MountainSeekerConfig.authorizedCurrencies`
     */
    private filterByAuthorizedCurrencies(markets: Array<Market>): Array<Market> {
        return markets.filter(market =>
            this.strategyDetails.config.authorizedCurrencies &&
            this.strategyDetails.config.authorizedCurrencies
                .some(currency => market.symbol.endsWith(currency)));
    }

    /**
     * Computes candlesticks for each market.
     * @returns A modified array of markets with a new element `candleSticks` added into `Ticker.info` sub-object
     */
    private async computeCandlesticks(markets: Array<Market>, interval: string, numberOfCandleSticks: number): Promise<void> {
        if (!interval || !numberOfCandleSticks) {
            throw new Error("Interval or number of candlesticks is undefined");
        }
        process.stdout.write(`Fetching candlesticks for ${markets.length} markets`);
        for (const market of markets) {
            market.candleSticks = await this.apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks);
            process.stdout.write(".");
        }
    }

    /**
     * Computes percentage variations of each candlestick in each market.
     * @returns A modified array of markets with a new element `candleStickVariations` added into `Ticker.info` sub-object
     */
    private static computeCandlestickPercentVariations(markets: Array<Market>): void {
        for (const market of markets) {
            const candleSticks = market.candleSticks; // a candlestick has a format [ timestamp, open, high, low, close, volume ]
            const candleStickVariations = [];
            for (const candle of candleSticks) {
                candleStickVariations.push(this.computePercentVariation(candle[1], candle[4]));
            }
            market.candleSticksPercentageVariations = candleStickVariations;
        }
    }

    /**
     * @returns A variation in % between two numbers `start` and `end`. Can be negative.
     */
    private static computePercentVariation(start: number, end: number): number {
        // TODO : division by zero ?
        return 100 - ((100 / end) * start);  // TODO : check why I am not getting exact same numbers as in Binance
    }

    /**
     * @returns `true` if the array has a duplicated number after rounding them all to 5th digit
     */
    private static arrayHasDuplicatedNumber(array: Array<number>): boolean {
        for (let i = 0; i < array.length; i++) {
            for (let j = 0; j < array.length && i !== j; j++) {
                if (array[i].toFixed(5) === array[j].toFixed(5)) {
                    return true;
                }
            }
        }
        return false;
    }

    getTradingState(): TradingState {
        return this.state;
    }
}

export type MountainSeekerConfig = BaseStrategyConfig & {
    /** The currencies that the strategy is allowed to use for trading.
     * Example: we want to buy on GAS/BTC market but we only have EUR in the wallet.
     * Therefore, the strategy will convert EUR to BTC */
    authorizedCurrencies?: Array<string>;

    /** Used to keep only those markets that have at least this number of percentage variation
     * in last 24 hours. Can be negative */
    minimumPercentFor24hrVariation?: number;

    /** '1m', '15m', '1h' ... */
    candleStickInterval?: string;

    /** The number of total candlesticks that will be analyzed per market. The minimum is 3. */
    candleStickNumber?: number;
}