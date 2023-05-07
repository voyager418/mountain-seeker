import { getCandleSticksByInterval, Market, TOHLCVF } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";
import assert from "assert";
import log from '../logging/log.instance';
import { NumberUtils } from "./number-utils";
import { cloneDeep } from "lodash";

/**
 * Utility class for strategies package
 */
export class StrategyUtils {

    /**
     * Computes and sets percentage variations of each candlestick in each market for the provided interval.
     */
    static setCandlestickPercentVariations(markets: Array<Market>, interval: CandlestickInterval): void {
        for (const market of markets) {
            const candleSticks = getCandleSticksByInterval(market, interval); // a candlestick has a format [ timestamp, open, high, low, close, volume ]
            const candleStickVariations = [];
            for (let i = 0; i < candleSticks.length - 1; i++) {
                candleStickVariations.push(NumberUtils.getPercentVariation(candleSticks[i][1], candleSticks[i][4]));
            }
            // the last candlestick percentage variation is calculated by taking the close price of previous
            // candle stick and the current market price
            candleStickVariations.push((NumberUtils.getPercentVariation(
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
     * @return Markets that are not defined in {@link MountainSeekerV2Config.ignoredMarkets} and that do not have
     * as targetAsset the one that is contained in the ignored markets array.
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
     * @return Markets that are defined in {@link MountainSeekerV2Config.authorizedMarkets}
     */
    static filterByAuthorizedMarkets(markets: Array<Market>, authorizedMarkets?: Array<string>): Array<Market> {
        if (authorizedMarkets && authorizedMarkets.length > 0) {
            return markets.filter(market => authorizedMarkets.some(symbol => symbol === market.symbol));
        }
        return markets;
    }

    /**
     * @return Markets that are not BLVT (binance leveraged tokens)
     */
    static filterBLVT(markets: Array<Market>): Array<Market> {
        return markets.filter(market => !market.symbol.split("/")[0].endsWith("UP") &&
            !market.symbol.split("/")[0].endsWith("DOWN"));
    }

    /**
     * @return Markets which accept quote orders (you can say how much you want to spend)
     */
    static filterQuoteOrderMarkets(markets: Array<Market>): Array<Market> {
        return markets.filter(market => market.quoteOrderQtyMarketAllowed);
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
     * @return -1 if the condition was never true or the number of bars since the last time the condition was true
     */
    static barsSince(condition: (x: Array<number>, y: Array<number>) => boolean, x: Array<number>, y: Array<number>): number {
        let res = 0;
        for (let i = 1; i < x.length - 1; i++) { // TODO or for (let i = x.length - 1; i > 1; i--) ?
            if (condition(x.slice(0, x.length - i), y.slice(0, y.length - i))) {
                return res;
            }
            res++;
        }
        return -1;
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
    static getCandleStick(array: Array<TOHLCVF>, indexFromEnd: number): TOHLCVF {
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
    private static convert(from: CandlestickInterval, to: CandlestickInterval, inputCandleSticks: Array<TOHLCVF>): Array<TOHLCVF> {
        assert(from === CandlestickInterval.DEFAULT, `Unhandled interval ${from}.
         Can only convert from ${CandlestickInterval.DEFAULT}`);
        switch (to) {
        case CandlestickInterval.FIFTEEN_MINUTES:
            return this.constructCandleSticks(inputCandleSticks, 3, 5);
        case CandlestickInterval.THIRTY_MINUTES:
            return this.constructCandleSticks(inputCandleSticks, 6, 5);
        case CandlestickInterval.ONE_HOUR:
            return this.constructCandleSticks(inputCandleSticks, 12, 5);
        default: throw new Error(`Unhandled candlestick interval: ${to}`);
        }
    }

    /**
     * @param inputCandleSticks
     * @param numberOfDefaultCandlesInDesiredPeriod For example to convert 30m to 4h candle sticks then this value must be
     * 8 because there are 8 30m candle sticks in 4h
     */
    private static constructCandleSticks(inputCandleSticks: Array<TOHLCVF>, numberOfDefaultCandlesInDesiredPeriod: number,
        minutesInDefaultCandle: number): Array<TOHLCVF> {
        const res: Array<TOHLCVF> = [];

        const minuteOfLastCandle = new Date(inputCandleSticks[inputCandleSticks.length - 1][0]).getMinutes();
        const minutesInDesiredCandle = minutesInDefaultCandle * numberOfDefaultCandlesInDesiredPeriod;
        const amountOfDefaultCandlesInLatestPeriod = ((minuteOfLastCandle - Math.floor(minuteOfLastCandle/minutesInDesiredCandle)
            * minutesInDesiredCandle)/minutesInDefaultCandle) + 1;
        let candleSticksInDesiredPeriod;

        // constructing the latest period
        candleSticksInDesiredPeriod = inputCandleSticks.slice(inputCandleSticks.length - amountOfDefaultCandlesInLatestPeriod);
        this.constructLargerCandle(candleSticksInDesiredPeriod, res, true);

        for (let i = inputCandleSticks.length - 1 - amountOfDefaultCandlesInLatestPeriod; i > 0; i -= numberOfDefaultCandlesInDesiredPeriod) {
            if (i - numberOfDefaultCandlesInDesiredPeriod > 0) {
                candleSticksInDesiredPeriod = inputCandleSticks.slice(i - numberOfDefaultCandlesInDesiredPeriod + 1, i + 1);
                this.constructLargerCandle(candleSticksInDesiredPeriod, res);
            }
        }
        return res.reverse();
    }

    private static constructLargerCandle(candleSticksInDesiredPeriod: Array<TOHLCVF>, res: Array<TOHLCVF>, addFetchDate?: boolean): void {
        const firstCandle = candleSticksInDesiredPeriod[0];
        const lastCandle = candleSticksInDesiredPeriod[candleSticksInDesiredPeriod.length - 1];

        const highestPrice = candleSticksInDesiredPeriod.map(candle => candle[2])
            .reduce((prev, current) => (prev > current ? prev : current));

        const lowestPrice = candleSticksInDesiredPeriod.map(candle => candle[3])
            .reduce((prev, current) => (prev < current ? prev : current));

        const totalVolume = candleSticksInDesiredPeriod.map(candle => candle[5])
            .reduce((prev, current) => prev + current);

        const tempCandle: TOHLCVF = [firstCandle[0], firstCandle[1], highestPrice,
            lowestPrice, lastCandle[4], totalVolume];
        if (addFetchDate) {
            tempCandle.push(lastCandle[6]);
        }
        res.push(tempCandle);
    }

    /**
     * @return the maximum % variation between the open/close in a set of candles sticks
     * i.e. the maximum change between 2 extremities of a series
     */
    static getMaxVariation(candleSticks : Array<TOHLCVF>): number {
        const highestOpen = candleSticks.map(candle => candle[1])
            .reduce((prev, current) => (prev > current ? prev : current));
        const highestClose = candleSticks.map(candle => candle[4])
            .reduce((prev, current) => (prev > current ? prev : current));
        const highest = Math.max(highestOpen, highestClose);
        const lowestOpen = candleSticks.map(candle => candle[1])
            .reduce((prev, current) => (prev < current ? prev : current));
        const lowestClose = candleSticks.map(candle => candle[4])
            .reduce((prev, current) => (prev < current ? prev : current));
        const lowest = Math.min(lowestOpen, lowestClose);
        return Math.abs(NumberUtils.getPercentVariation(highest, lowest));
    }

    static getCandleSticksExceptLast(market: Market, interval: CandlestickInterval) : Array<TOHLCVF> {
        const candleSticksExceptLast = cloneDeep(market.candleSticks.get(interval)!);
        candleSticksExceptLast.pop();
        return candleSticksExceptLast;
    }

    static getCandleSticksPercentVariationsExceptLast(market: Market, interval: CandlestickInterval) : Array<number> {
        const candleSticksPercentageVariationsExceptLast = cloneDeep(market.candleSticksPercentageVariations.get(interval)!);
        candleSticksPercentageVariationsExceptLast.pop();
        return candleSticksPercentageVariationsExceptLast;
    }

    static getOriginAssetVolume(candles: Array<TOHLCVF>): number {
        return candles.map(candle => candle[1] * candle[5]!).reduce((sum, current) => sum + current, 0)!;
    }

    /**
     * Removes markets that had a volume of 0% at least 3 times in the last 50 five min candlesticks
     */
    static filterDeadMarkets(markets: Array<Market>): Array<Market> {
        return markets.filter(market => !this.isDeadMarket(market).isDead);
    }

    /**
     * @return `isDead` boolean indicating if there is not much activity on the market and a
     * `times` number indicating inactivity in range of last 50 five minute candles
     */
    static isDeadMarket(market: Market): {isDead: boolean, times: number} {
        let volumes = market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!.map(candle => candle[5]);
        if (!volumes) {
            log.warn(`Candlesticks with ${CandlestickInterval.FIVE_MINUTES} interval not found`);
            return { isDead: false, times: -1 };
        }
        volumes = volumes.slice(-50);
        const zeroChangeOccurrences = volumes.reduce((prev, current) => prev + (current === 0 ? 1 : 0), 0);
        return { isDead: zeroChangeOccurrences > 3, times: zeroChangeOccurrences };
    }

    static getSecondsDifferenceBetweenDates(currentDate: Date, pastDate: Date): number {
        return Math.round((currentDate.getTime() - pastDate.getTime())/1000);
    }
}