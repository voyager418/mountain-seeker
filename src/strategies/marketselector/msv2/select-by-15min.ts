import { Market, TOHLCV } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2Config } from "../../config/mountain-seeker-v2-config";

export class SelectBy15min {
    private static readonly INTERVAL = CandlestickInterval.FIFTEEN_MINUTES;

    static shouldSelectMarket(config: MountainSeekerV2Config, market: Market, candleSticks: Array<TOHLCV>,
        candleSticksPercentageVariations: Array<number>): SelectorResult | undefined {
        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = config.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return undefined;
        }

        // should be in some range
        if (market.percentChangeLast24h! < -3 || market.percentChangeLast24h! > 25) {
            return undefined;
        }

        // should make a decision at fixed minutes
        const tradingLoopConfig = config.activeCandleStickIntervals!.get(this.INTERVAL)!;
        const minuteOfLastCandlestick = new Date(StrategyUtils.getCandleStick(candleSticks, 0)[0]).getMinutes();
        const currentMinute = new Date().getMinutes();
        if (tradingLoopConfig.decisionMinutes.indexOf(minuteOfLastCandlestick) === -1 ||
            (tradingLoopConfig.decisionMinutes.indexOf(currentMinute) === -1 &&
                tradingLoopConfig.decisionMinutes.indexOf(currentMinute - 1) === -1)) {
            return undefined;
        }

        const beforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 1);

        // if before last candle percent change is below minimal threshold
        if (beforeLastCandlestickPercentVariation < 2) {
            return undefined;
        }

        // if before last candle percent change is above maximal threshold
        if (beforeLastCandlestickPercentVariation > 20) {
            return undefined;
        }

        const beforeBeforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 2);

        // if before before last candle percent change is below minimal threshold
        if (beforeBeforeLastCandlestickPercentVariation < 1.5) {
            return undefined;
        }

        // if before before last candle percent change is above maximal threshold
        if (beforeBeforeLastCandlestickPercentVariation > 10) {
            return undefined;
        }

        const allCandlesticks = candleSticks;
        let twentyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 20 - 3, -3);

        // c2 close must be > c3..20 high
        const beforeBeforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 2);
        if (twentyCandlesticks.some(candle => candle[2] > beforeBeforeLastCandle[4])) {
            return undefined;
        }

        // v1 must be >= 1.2 * v2..20
        const beforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 1);
        if (beforeLastCandle[5] < 1.2 * beforeBeforeLastCandle[5] ||
            twentyCandlesticks.some(candle => beforeLastCandle[5] < 1.2 * candle[5])) {
            return undefined;
        }

        // if the line is not +/- horizontal
        twentyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 20 - 6, -6); // except the last 6
        // the variation of the 20 candlesticks should not be bigger than 5%
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticks);
        // if (maxVariation > 5) {
        //     return;
        // }
        // the variation of the first and last in the 20 candlesticks should not be bigger than 5% // TODO 5 or 3?
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticks[0][4],
            twentyCandlesticks[twentyCandlesticks.length - 1][4]));
        // if (edgeVariation > 5) {
        //     return;
        // }
        return { market, interval: this.INTERVAL, maxVariation, edgeVariation, volumeRatio: beforeLastCandle[5] / beforeBeforeLastCandle[5] };
    }
}