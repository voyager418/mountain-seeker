import assert from "assert";
import { Currency } from "../enums/trading-currencies.enum";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";

export type Market = {
    /** Example : "BNB/EUR" */
    symbol: string;

    /** Currency with which we buy (e.g. "EUR", "BTC", "BNB" ...) */
    originAsset: Currency;

    /** The asset that we buy (e.g. "DOGE") */
    targetAsset: string;

    /** Candlesticks grouped by their interval.
     * A candlestick has the following shape : [ timestamp, open, high, low, close, volume ] */
    candleSticks: Map<CandlestickInterval, Array<TOHLCVF>>;

    /** Variations in percent for each candleStick defined in `Market.candleSticks`, grouped by the interval.
     * Each percentage variation array is ordered from oldest to more recent.
     * The last number is a variation of the current price.
     */
    candleSticksPercentageVariations: Map<CandlestickInterval, Array<number>>;

    /** The unit price of the target asset on the moment of retrieving market information */
    targetAssetPrice: number;

    /** All available candlestick intervals for the market
     * E.g. : "1m", "15m", 1h" ... */
    candleStickIntervals: Array<CandlestickInterval>;

    /** Price % variation for last 24 hours */
    percentChangeLast24h?: number;

    /** Volume of the origin currency traded for last 24 hours */
    originAssetVolumeLast24h?: number;

    /** Volume of the target currency traded for last 24 hours */
    targetAssetVolumeLast24h?: number;

    /** Minimum notional value allowed for a buy order. An order's notional value
     * is the price * quantity */
    minNotional?: number;

    /** Maximum amount of target asset that an account can hold */
    maxPosition?: number;

    /** Number of digits after the dot related to the quantity of the {@link targetAsset} that the market authorizes
     * for buy/sell orders */
    amountPrecision?: number;

    /** Number of digits after the dot related to the quantity of the {@link originAsset} that the market authorizes
     * for buy/sell orders */
    pricePrecision?: number;

    /** If `true` then for buy orders we can specify the price that we want to spend.
     * We also can but are not obliged to specify the amount that we want to buy instead of the price to spend. */
    quoteOrderQtyMarketAllowed?: boolean;
}

/** [ timestamp, open, high, low, close, volume, optional fetch timestamp ] */
export type TOHLCVF = [number, number, number, number, number, number, number?];

// TODO move the methods to a utility class
export function getCurrentCandleStickPercentageVariation(array: Array<number>): number {
    assert(array.length >= 1, `Candlestick percentage variation array is too short,
     wanted at least 1 element but got ${array.length}`);
    return array[array.length - 1];
}

export function getCandleSticksByInterval(market: Market, interval: CandlestickInterval) : Array<TOHLCVF> {
    assert(market.candleSticks.get(interval) !== undefined, `No candlesticks found for market ${market.symbol} and interval ${interval}`);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return market.candleSticks.get(interval)!;
}

export function getCandleSticksPercentageVariationsByInterval(market: Market, interval: CandlestickInterval) : Array<number> {
    assert(market.candleSticksPercentageVariations.get(interval) !== undefined, `No candlesticks percentage variations found for market ${market.symbol}
     and interval ${interval}`);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return market.candleSticksPercentageVariations.get(interval)!;
}