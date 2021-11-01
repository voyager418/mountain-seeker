import { getCandleSticksByInterval, Market, TOHLCV } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";
import assert from "assert";
import log from '../logging/log.instance';

/**
 * Utility class for strategies package
 */
export class StrategyUtils {

    /**
     * @return A variation in % between two numbers `start` and `end`. Can be negative.
     */
    static getPercentVariation(start: number, end: number): number {
        if (start === 0) {
            start = 0.00000001;
        }
        if (start <= end) {
            return Math.abs(((end - start) / start) * 100);
        } else {
            return -((start - end) / start) * 100;
        }
    }

    /**
     * Computes and sets percentage variations of each candlestick in each market for the provided interval.
     */
    static setCandlestickPercentVariations(markets: Array<Market>, interval: CandlestickInterval): void {
        for (const market of markets) {
            const candleSticks = getCandleSticksByInterval(market, interval); // a candlestick has a format [ timestamp, open, high, low, close, volume ]
            const candleStickVariations = [];
            for (let i = 0; i < candleSticks.length - 1; i++) {
                candleStickVariations.push(StrategyUtils.getPercentVariation(candleSticks[i][1], candleSticks[i][4]));
            }
            // the last candlestick percentage variation is calculated by taking the close price of previous
            // candle stick and the current market price
            candleStickVariations.push((StrategyUtils.getPercentVariation(
                candleSticks[candleSticks.length - 2][4], market.targetAssetPrice)));
            if (!market.candleSticksPercentageVariations) {
                market.candleSticksPercentageVariations = new Map();
            }
            market.candleSticksPercentageVariations.set(interval, candleStickVariations);
        }
    }

    /**
     * Populates the fields {@link Market.candleSticks} and {@link Market.candleStickIntervals} by computing
     * new candlesticks with the provided {@param interval}
     */
    static addCandleSticksWithInterval(markets: Array<Market>, interval: CandlestickInterval): void {
        for (const market of markets) {
            const candleSticksToAdd = this.convert(CandlestickInterval.DEFAULT, interval,
                getCandleSticksByInterval(market, CandlestickInterval.DEFAULT));
            market.candleSticks.set(interval, candleSticksToAdd);
            market.candleStickIntervals.push(interval);
        }
    }
    
    /**
     * @return `true` if the array has a duplicated number after rounding them all to 5th digit,
     * `false` otherwise
     */
    static arrayHasDuplicatedNumber(array: Array<number>): boolean {
        for (let i = 0; i < array.length; i++) {
            for (let j = 0; j < array.length && i !== j; j++) {
                if (array[i] !== 0 && array[i].toFixed(5) === array[j].toFixed(5)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * @return Markets that can be traded with currencies defined in `MountainSeekerConfig.authorizedCurrencies`
     */
    static filterByAuthorizedCurrencies(markets: Array<Market>, authorizedCurrencies?: Array<Currency>): Array<Market> {
        return markets.filter(market => authorizedCurrencies && authorizedCurrencies
            .some(currency => market.originAsset === currency));
    }

    /**
     * @return Markets that are not defined in {@link MountainSeekerConfig.ignoredMarkets} and that do not have
     * as targetAsset the one that is contained in the ignore markets array.
     *
     * Example: if ignored markets = ["KNC/BTC"]
     * Then this method returns all markets except ["KNC/BTC", "KNC/BNB", ... ]
     */
    static filterByIgnoredMarkets(markets: Array<Market>, ignoredMarkets?: Array<string>): Array<Market> {
        if (ignoredMarkets && ignoredMarkets.length > 0) {
            return markets.filter(market => !ignoredMarkets
                .some(symbol => market.symbol.startsWith(symbol.split('/')[0])));
        }
        return markets;
    }

    /**
     * @return Markets that have traded at least the specified amount of volume or more
     */
    static filterByMinimumTradingVolume(markets: Array<Market>, minimumTradingVolumeLast24h?: number): Array<Market> {
        if (minimumTradingVolumeLast24h) {
            return markets.filter(market => market.originAssetVolumeLast24h &&
                (market.originAssetVolumeLast24h >= minimumTradingVolumeLast24h));
        }
        return markets;
    }

    /**
     * @return Markets that are defined in {@link MountainSeekerConfig.authorizedMarkets}
     */
    static filterByAuthorizedMarkets(markets: Array<Market>, authorizedMarkets?: Array<string>): Array<Market> {
        if (authorizedMarkets && authorizedMarkets.length > 0) {
            return markets.filter(market => authorizedMarkets.some(symbol => symbol === market.symbol));
        }
        return markets;
    }

    /**
     * @return Markets that can accept at least `minimalPrecision` digits after the dot in the amounts
     * used in buy/sell orders
     */
    static filterByAmountPrecision(markets: Array<Market>, minimalPrecision?: number): Array<Market> {
        if (minimalPrecision) {
            return markets.filter(market => market.amountPrecision && market.amountPrecision >= minimalPrecision);
        }
        return markets;
    }

    /**
     * @return Markets that have at least {@param minAmount} of candlesticks with the specified {@param candleStickInterval}
     */
    static filterByMinimumAmountOfCandleSticks(markets: Array<Market>, minAmount: number, candleStickInterval: CandlestickInterval) : Array<Market> {
        return markets.filter(market => market.candleSticks.get(candleStickInterval)!.length >= minAmount);
    }

    /**
     * @return Markets that are not like PHB/BTC, QKC/BTC or DF/ETH
     */
    static filterByStrangeMarkets(markets: Array<Market>, candleStickInterval: CandlestickInterval): Array<Market> {
        return markets.filter(market => {
            let candleStickPercentVariations = market.candleSticksPercentageVariations.get(candleStickInterval);
            if (!candleStickPercentVariations) {
                log.warn(`Candlesticks with ${candleStickInterval} interval not found`);
                return false;
            }
            candleStickPercentVariations = candleStickPercentVariations.slice(candleStickPercentVariations.length - 30);
            return !this.arrayHasDuplicatedNumber(candleStickPercentVariations);
        });
    }

    /**
     * @return The market with the highest price increase in the last 24h
     */
    static highestBy24hVariation(potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>): undefined | Market {
        if (potentialMarkets.length === 0) {
            return undefined;
        }
        potentialMarkets.sort((first, second) => {
            // for more details see https://developer.mozilla.org/en-US/docs/web/javascript/reference/global_objects/array/sort#description
            return second.market.percentChangeLast24h! - first.market.percentChangeLast24h!;
        });
        return potentialMarkets[0].market;
    }

    /**
     * @return 0 if the condition was never true or the number of bars since the last time the condition was true
     */
    static barsSince(condition: (x: Array<number>, y: Array<number>) => boolean, x: Array<number>, y: Array<number>): number {
        let res = 0;
        for (let i = 0; i < x.length - 1; i++) {
            if (condition(x.slice(0, x.length - i), y.slice(0, y.length - i))) {
                return res;
            }
            res++;
        }
        return 0;
    }

    /**
     * The `x`-series is defined as having crossed over `y`-series if the value
     * of `x` is greater than the value of `y` and the value of `x` was less than the
     * value of `y` on the bar immediately preceding the current bar.
     * @param x
     * @param y
     */
    static crossover(x: Array<number>, y: Array<number>): boolean {
        assert(x.length >= 2, `x array should at least contain 2 elements`);
        assert(y.length >= 2, `y array should at least contain 2 elements`);
        return x[x.length - 2] < y[y.length - 2] && x[x.length - 1] > y[y.length - 1];
    }

    /**
     * @param array
     * @param indexFromEnd 0 based
     */
    static getCandleStick(array: Array<TOHLCV>, indexFromEnd: number): TOHLCV {
        assert(array.length >= indexFromEnd, `Candlestick array is too short, wanted at least ${indexFromEnd} elements but got ${array.length}`);
        return array[array.length - 1 - indexFromEnd];
    }

    /**
     * @param array
     * @param indexFromEnd 0 based
     */
    static getCandleStickPercentageVariation(array: Array<number>, indexFromEnd: number): number {
        assert(array.length >= indexFromEnd, `Candlestick percentage variation array is too short,
     wanted at least ${indexFromEnd + 1} elements but got ${array.length}`);
        return array[array.length - 1 - indexFromEnd];
    }

    /**
     * @param from Candlesticks interval of {@param inputCandleSticks}
     * @param to The interval with which the new candlesticks will be created
     * @param inputCandleSticks Input candlesticks with interval of {@param from}
     */
    private static convert(from: CandlestickInterval, to: CandlestickInterval, inputCandleSticks: Array<TOHLCV>): Array<TOHLCV> {
        assert(from === CandlestickInterval.DEFAULT, `Unhandled interval ${from}.
         Can only convert from ${CandlestickInterval.DEFAULT}`);
        switch (to) {
        case CandlestickInterval.THIRTY_MINUTES:
            return this.constructCandleSticks(inputCandleSticks, 2);
        case CandlestickInterval.ONE_HOUR:
            return this.constructCandleSticks(inputCandleSticks, 4);
        default: throw new Error(`Unhandled candlestick interval: ${to}`);
        }
    }

    /**
     * @param inputCandleSticks
     * @param numberOf30mCandlesInDesiredPeriod For example to convert 30m to 4h candle sticks then this value must be
     * 8 because there are 8 30m candle sticks in 4h
     */
    private static constructCandleSticks(inputCandleSticks: Array<TOHLCV>, numberOf30mCandlesInDesiredPeriod: number): Array<TOHLCV> {
        const res: Array<TOHLCV> = [];
        res.push(inputCandleSticks[inputCandleSticks.length - 1]); // putting latest 30min candle as the last candle in desired period

        for (let i = inputCandleSticks.length - 2; i > 0; i -= numberOf30mCandlesInDesiredPeriod) {
            if (i - numberOf30mCandlesInDesiredPeriod > 0) {
                const candleSticksInDesiredPeriod = inputCandleSticks.slice(i - numberOf30mCandlesInDesiredPeriod + 1, i + 1);
                const first30MinCandle = candleSticksInDesiredPeriod[0];
                const last30MinCandle = candleSticksInDesiredPeriod[numberOf30mCandlesInDesiredPeriod - 1];

                const highestPrice = candleSticksInDesiredPeriod.map(candle => candle[2])
                    .reduce((prev, current) => (prev > current ? prev : current));

                const lowestPrice = candleSticksInDesiredPeriod.map(candle => candle[3])
                    .reduce((prev, current) => (prev < current ? prev : current));

                const totalVolume = candleSticksInDesiredPeriod.map(candle => candle[5])
                    .reduce((prev, current) => prev + current);

                const tempCandle: TOHLCV = [first30MinCandle[0], first30MinCandle[1], highestPrice,
                    lowestPrice, last30MinCandle[4], totalVolume];
                res.push(tempCandle);
            }
        }
        return res.reverse();
    }
}