import { TOHLCVF } from "../models/market";


export interface Indicator {

    /**
     * @return {@link IndicatorOutput} object
     */
    compute(candleSticks: Array<TOHLCVF>, params?: any): IndicatorOutput<any>

}

export type IndicatorOutput<T> = {
    /** if true then indicator thinks that you should buy */
    shouldBuy?: boolean,
    /** the result that was computed by the indicator */
    result: T
}