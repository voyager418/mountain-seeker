import { Market } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";

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
        return 100 - ((100 / end) * start); // TODO : check why I am not getting exact same numbers as in Binance
    }

    /**
     * Computes percentage variations of each candlestick in each market.
     */
    static computeCandlestickPercentVariations(markets: Array<Market>): void {
        for (const market of markets) {
            const candleSticks = market.candleSticks; // a candlestick has a format [ timestamp, open, high, low, close, volume ]
            const candleStickVariations = [];
            for (let i = 0; i < candleSticks.length - 1; i++) {
                candleStickVariations.push(StrategyUtils.getPercentVariation(candleSticks[i][1], candleSticks[i][4]));
            }
            // the last candlestick percentage variation is calculated by taking the close price of previous
            // candle stick and the current market price
            candleStickVariations.push((StrategyUtils.getPercentVariation(
                candleSticks[candleSticks.length - 2][4], market.targetAssetPrice)));
            market.candleSticksPercentageVariations = candleStickVariations;
        }
    }

    /**
     * @return `true` if the array has a duplicated number after rounding them all to 5th digit,
     * `false` otherwise
     */
    static arrayHasDuplicatedNumber(array: Array<number>): boolean {
        for (let i = 0; i < array.length; i++) {
            for (let j = 0; j < array.length && i !== j; j++) {
                if (array[i].toFixed(5) === array[j].toFixed(5)) {
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
}