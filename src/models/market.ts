import assert from "assert";
import { Currency } from "../enums/trading-currencies.enum";

export type Market = {
    /** Example : "BNB/EUR" */
    symbol: string;

    /** Currency with which we buy (e.g. "EUR", "BTC", "BNB" ...) */
    originAsset: Currency;

    /** The asset that we buy (e.g. "BNB") */
    targetAsset: string;

    /** An array of candlesticks.
     * A candlestick has the following shape : [ timestamp, open, high, low, close, volume ] */
    candleSticks: Array<TOHLCV>;

    /** An array of variations in percent for each candleStick defined in `Market.candleSticks` array.
     * Ordered from oldest to more recent. The last number is a variation of the current price.
     */
    candleSticksPercentageVariations: Array<number>;

    /** The unit price of the target asset on the moment of retrieving market information */
    targetAssetPrice: number;

    /** "1m", "15m", 1h" ... */
    candleStickInterval?: string;

    /** Price % variation for last 24 hours */
    percentChangeLast24h?: number;

    /** Volume of the origin currency traded for last 24 hours */
    originAssetVolumeLast24h?: number;

    /** Volume of the target currency traded for last 24 hours */
    targetAssetVolumeLast24h?: number;

    /** Minimum notional value allowed for a buy order. An order's notional value
     * is the price * quantity */
    minNotional?: number;

    /** Number of digits after the dot related to the quantity of the {@link targetAsset} that the market authorizes
     * for buy/sell orders */
    amountPrecision?: number;
}

/** [ timestamp, open, high, low, close, volume ] */
export type TOHLCV = [number, number, number, number, number, number];

export function getCandleStick(array: Array<Array<number>>, index: number): Array<number> {
    assert(array.length >= index, `Candlestick array is too short, wanted at least ${index} elements but got ${array.length}`);
    return array[index];
}

export function getCurrentCandleStickPercentageVariation(array: Array<number>): number {
    assert(array.length >= 1, `Candlestick percentage variation array is too short,
     wanted at least 1 element but got ${array.length}`);
    return array[array.length - 1];
}

export function getCandleStickPercentageVariation(array: Array<number>, index: number): number {
    assert(array.length >= index, `Candlestick percentage variation array is too short,
     wanted at least ${index + 1} elements but got ${array.length}`);
    return array[index];
}