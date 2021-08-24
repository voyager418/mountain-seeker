import { Indicator } from "./indicator.interface";
import { singleton } from "tsyringe";
import { TOHLCV } from "../models/market";
const MACD = require('technicalindicators').MACD;

/**
 * MACD indicator
 */
@singleton()
export class MACDIndicator implements Indicator {

    shouldBuy(candleSticks: Array<TOHLCV>): boolean {
        const macdResult = MACD.calculate({
            values: candleSticks.map(candle => candle[4]), // MACD is based on the close price
            SimpleMAOscillator: false, // when both set to false then we get similar results as in tradingview
            SimpleMASignal: false,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
        });

        const lastResult = macdResult[macdResult.length - 1];
        return lastResult.MACD > lastResult.signal;
    }
}