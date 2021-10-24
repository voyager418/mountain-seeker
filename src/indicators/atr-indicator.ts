import { Indicator, IndicatorOutput } from "./indicator.interface";
import { singleton } from "tsyringe";
import { TOHLCV } from "../models/market";
const ATR = require('technicalindicators').ATR;

/**
 * ATR indicator
 */
@singleton()
export class ATRIndicator implements Indicator {

    compute(candleSticks: Array<TOHLCV>, params: { period: number }): IndicatorOutput<number[]> {
        const ATRResult = ATR.calculate({
            low: candleSticks.map(candle => candle[3]),
            high: candleSticks.map(candle => candle[2]),
            close: candleSticks.map(candle => candle[4]),
            period: params.period
        });

        return {
            result: ATRResult
        };
    }
}