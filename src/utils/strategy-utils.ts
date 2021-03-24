import { Market } from "../models/market";

/**
 * Utility class for strategies package
 */
export class StrategyUtils {
    /**
     * @return A variation in % between two numbers `start` and `end`. Can be negative.
     */
    static computePercentVariation(start: number, end: number): number {
        // TODO : division by zero ?
        return 100 - ((100 / end) * start);  // TODO : check why I am not getting exact same numbers as in Binance
    }

    /**
     * Computes percentage variations of each candlestick in each market.
     */
    static computeCandlestickPercentVariations(markets: Array<Market>): void {
        for (const market of markets) {
            const candleSticks = market.candleSticks; // a candlestick has a format [ timestamp, open, high, low, close, volume ]
            const candleStickVariations = [];
            for (const candle of candleSticks) {
                candleStickVariations.push(StrategyUtils.computePercentVariation(candle[1], candle[4]));
            }
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
}