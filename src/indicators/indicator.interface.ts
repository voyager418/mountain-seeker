import { TOHLCV } from "../models/market";


export interface Indicator {

    /**
     * @return True if the indicator thinks that you should buy
     */
    shouldBuy(candleSticks: Array<TOHLCV>): boolean

}