import { Market } from "../../models/market";
import { CandlestickInterval } from "../../enums/candlestick-interval.enum";
import { Strategy, StrategyName } from "../../models/strategy";

/**
 * Interface for selecting a market (like a custom indicator)
 */
export interface Selector {
    /**
     * @return Market and some details if a trade is eligible to start or undefined otherwise
     */
    isMarketEligible(state: any, market: Market, strategy: Strategy<any>): SelectorResult | undefined;
}

export type SelectorResult = {
    market: Market,
    interval: CandlestickInterval,
    strategyCustomName: StrategyName,
    maxVariation?: number,
    edgeVariation?: number,
    volumeRatio?: number,
    earlyStart?: boolean;
    BUSDVolumeLast5h?: number;
    BUSDVolumeLast10h?: number;
}