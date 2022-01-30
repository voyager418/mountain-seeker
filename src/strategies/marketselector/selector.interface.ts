import { Market } from "../../models/market";
import { CandlestickInterval } from "../../enums/candlestick-interval.enum";

/**
 * Interface for selecting a market (like a custom indicator)
 */
export interface Selector {
    /**
     * @return Market and some details if a trade is eligible to start or undefined otherwise
     */
    isMarketEligible(config: any, market: Market, interval: CandlestickInterval): SelectorResult | undefined;
}

export type SelectorResult = {
    market: Market,
    interval: CandlestickInterval,
    maxVariation?: number,
    edgeVariation?: number,
    volumeRatio?: number
}