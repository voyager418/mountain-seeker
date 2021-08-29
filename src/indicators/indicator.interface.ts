import { TOHLCV } from "../models/market";


export interface Indicator {

    /**
     * @return {@link IndicatorOutput} object
     */
    compute(candleSticks: Array<TOHLCV>): IndicatorOutput<any>

}

export type IndicatorOutput<T> = {
    shouldBuy: boolean, // if true then indicator thinks that you should buy
    result: T // the result that was computed by the indicator
}