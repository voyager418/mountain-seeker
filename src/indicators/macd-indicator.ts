import { Indicator, IndicatorOutput } from "./indicator.interface";
import { singleton } from "tsyringe";
import { TOHLCV } from "../models/market";
import { MACDOutput } from "technicalindicators/declarations/moving_averages/MACD";
const MACD = require('technicalindicators').MACD;

/**
 * MACD indicator
 */
@singleton()
export class MACDIndicator implements Indicator {

    compute(candleSticks: Array<TOHLCV>): IndicatorOutput<MACDOutput[]> {
        const macdResult = MACD.calculate({
            values: candleSticks.map(candle => candle[4]), // MACD is based on the close price
            SimpleMAOscillator: false, // when both set to false then we get similar results as in tradingview
            SimpleMASignal: false,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
        });

        const lastResult = macdResult[macdResult.length - 1];
        const beforeLastResult = macdResult[macdResult.length - 2];
        return {
            shouldBuy: lastResult.MACD > lastResult.signal && lastResult.MACD > beforeLastResult.MACD,
            result: macdResult
        };
    }
}