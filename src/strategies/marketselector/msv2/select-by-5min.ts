import { Market, TOHLCV } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2Config } from "../../config/mountain-seeker-v2-config";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";

export class SelectBy5min {
    private static readonly INTERVAL = CandlestickInterval.FIVE_MINUTES;

    static shouldSelectMarket(config: MountainSeekerV2Config, state: MountainSeekerV2State, market: Market, candleSticks: Array<TOHLCV>,
        candleSticksPercentageVariations: Array<number>): SelectorResult | undefined {
        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = state.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return undefined;
        }

        // should be in some range
        if (market.percentChangeLast24h! < -3 || market.percentChangeLast24h! > 35) {
            return undefined;
        }

        // should make a decision at fixed minutes
        const tradingLoopConfig = config.activeCandleStickIntervals!.get(this.INTERVAL)!;
        const minuteOfLastCandlestick = new Date(StrategyUtils.getCandleStick(candleSticks, 0)[0]).getMinutes();
        if (tradingLoopConfig.decisionMinutes.indexOf(minuteOfLastCandlestick) === -1) {
            return undefined;
        }

        const c1Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 1);

        // if before last candle percent change is below minimal threshold
        if (c1Variation < 1.4) {
            return undefined;
        }

        // if before last candle percent change is above maximal threshold
        if (c1Variation > 12) {
            return undefined;
        }

        const c2Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 2);

        // if before before last candle percent change is below minimal threshold
        if (c2Variation < 1) {
            return undefined;
        }

        // if before before last candle percent change is above maximal threshold
        if (c2Variation > 7) {
            return undefined;
        }

        const allCandlesticks = candleSticks;
        const twentyFiveCandlesticks = allCandlesticks.slice(allCandlesticks.length - 25 - 3, -3); // except the last 3

        // c2 close must be > c3..25 high
        const c2 = StrategyUtils.getCandleStick(candleSticks, 2);
        if (twentyFiveCandlesticks.some(candle => candle[2] > c2[4])) {
            return undefined;
        }

        // v1 must be >= 1.2 * v2..25
        const c1 = StrategyUtils.getCandleStick(candleSticks, 1);
        if (c1[5] < 1.2 * c2[5] ||
            twentyFiveCandlesticks.some(candle => c1[5] < 1.2 * candle[5])) {
            return undefined;
        }

        // if the line is not +/- horizontal
        const twentyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 20 - 6, -6); // except the last 6
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticks);
        // the variation of the 20 candlesticks should not be bigger than 5%
        if (maxVariation > 5) {
            return undefined;
        }
        // the variation of the first and last in the 20 candlesticks should not be bigger than 5% // TODO 5 or 3?
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticks[0][4],
            twentyCandlesticks[twentyCandlesticks.length - 1][4]));
        if (edgeVariation > 5) {
            return undefined;
        }
        return { market, interval: this.INTERVAL, maxVariation, edgeVariation, volumeRatio: c1[5] / c2[5] };
    }
}