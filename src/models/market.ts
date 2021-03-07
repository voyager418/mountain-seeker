import assert from "assert";
import { Currency } from "../enums/trading-currencies.enum";

export type Market = {
    /** Example : 'BNB/EUR' */
    symbol: string;

    /** Currency with which we buy (e.g. 'EUR') */
    originAsset: Currency;

    /** The asset that we buy (e.g. 'BNB') */
    targetAsset: string;

    /** An array of candlesticks.
     * A candlestick has the following shape : [ timestamp, open, high, low, close, volume ] */
    candleSticks: Array<Array<number>>;

    /** An array of variations in percent for each candleStick defined in `Market.candleSticks` array.
     * Ordered from oldest to more recent. The last number is a variation of the current price.
     */
    candleSticksPercentageVariations: Array<number>;
}

export function getPreviousCandleStick(array: Array<Array<number>>): Array<number> {
    assert(array.length >= 2, `Candlestick array is too short, wanted at least 2 element but got ${array.length}`);
    return array[array.length - 2];
}

export function getCurrentCandleStickPercentageVariation(array: Array<number>): number {
    assert(array.length >= 1, `Candlestick percentage variation array is too short,
     wanted at least 1 element but got ${array.length}`);
    return array[array.length - 1];
}

export function getPreviousCandleStickPercentageVariation(array: Array<number>): number {
    assert(array.length >= 2, `Candlestick percentage variation array is too short,
     wanted at least 1 element but got ${array.length}`);
    return array[array.length - 2];
}