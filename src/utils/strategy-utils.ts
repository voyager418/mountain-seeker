import { getCandleSticksByInterval, Market, TOHLCV } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";
import assert from "assert";

/**
 * Utility class for strategies package
 */
export class StrategyUtils {
    private constructor() {
        // utility class
    }

    /**
     * @return A variation in % between two numbers `start` and `end`. Can be negative.
     */
    static getPercentVariation(start: number, end: number): number {
        // TODO : division by zero ?
        if (start <= end) {
            return Math.abs(((end - start) / (start)) * 100);
        } else {
            return -((start - end) / (start)) * 100;
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
            const candleSticksToAdd = this.convert(CandlestickInterval.THIRTY_MINUTES, interval,
                getCandleSticksByInterval(market, CandlestickInterval.THIRTY_MINUTES));
            market.candleSticks.set(interval, candleSticksToAdd);
            market.candleStickIntervals.push(interval);
        }
    }

    /**
     * @param from Candlesticks interval of {@param inputCandleSticks}
     * @param to The interval with which the new candlesticks will be created
     * @param inputCandleSticks Input candlesticks with interval of {@param from}
     */
    static convert(from: CandlestickInterval, to: CandlestickInterval, inputCandleSticks: Array<TOHLCV>): Array<TOHLCV> {
        assert(from === CandlestickInterval.THIRTY_MINUTES, `Unhandled interval ${from}.
         Can only convert from ${CandlestickInterval.THIRTY_MINUTES}`);
        const res: Array<TOHLCV> = [];
        switch (to) {
        case CandlestickInterval.FOUR_HOURS:
            for (let i = inputCandleSticks.length - 1; i > 0; i -= 8) {
                if (i - 8 > 0) {
                    const candleSticksInFourHourPeriod = inputCandleSticks.slice(i - 7, i + 1);
                    const first30MinCandle = candleSticksInFourHourPeriod[0];
                    const last30MinCandle = candleSticksInFourHourPeriod[7];

                    const highestPrice = candleSticksInFourHourPeriod.map(candle => candle[2])
                        .reduce((prev, current) => (prev > current ? prev : current));

                    const lowestPrice = candleSticksInFourHourPeriod.map(candle => candle[3])
                        .reduce((prev, current) => (prev < current ? prev : current));

                    const totalVolume = candleSticksInFourHourPeriod.map(candle => candle[5])
                        .reduce((prev, current) => prev + current);

                    const tempCandle: TOHLCV = [first30MinCandle[0], first30MinCandle[1], highestPrice,
                        lowestPrice, last30MinCandle[4], totalVolume];
                    res.push(tempCandle);
                }
            }
            break;
        case CandlestickInterval.SIX_HOURS:
            for (let i = inputCandleSticks.length - 1; i > 0; i -= 12) {
                if (i - 12 > 0) {
                    const candleSticksInSixHoursPeriod = inputCandleSticks.slice(i - 11, i + 1);
                    const first30MinCandle = candleSticksInSixHoursPeriod[0];
                    const last30MinCandle = candleSticksInSixHoursPeriod[11];

                    const highestPrice = candleSticksInSixHoursPeriod.map(candle => candle[2])
                        .reduce((prev, current) => (prev > current ? prev : current));

                    const lowestPrice = candleSticksInSixHoursPeriod.map(candle => candle[3])
                        .reduce((prev, current) => (prev < current ? prev : current));

                    const totalVolume = candleSticksInSixHoursPeriod.map(candle => candle[5])
                        .reduce((prev, current) => prev + current);

                    const tempCandle: TOHLCV = [first30MinCandle[0], first30MinCandle[1], highestPrice,
                        lowestPrice, last30MinCandle[4], totalVolume];
                    res.push(tempCandle);
                }
            }
            break;
        default: throw new Error(`Unhandled candlestick interval: ${to}`);
        }
        return res.reverse();
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
}