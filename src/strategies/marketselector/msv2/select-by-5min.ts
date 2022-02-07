import { Market, TOHLCV } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2Config } from "../../config/mountain-seeker-v2-config";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { cloneDeep } from 'lodash';

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

        const tradingLoopConfig = config.activeCandleStickIntervals!.get(this.INTERVAL)!;

        // allowed to start only 15 seconds earlier or at defined minutes
        const minuteOfLastCandlestick = new Date(StrategyUtils.getCandleStick(candleSticks, 0)[0]).getMinutes();
        const dateInFuture = new Date();
        dateInFuture.setSeconds(dateInFuture.getSeconds() + 15);
        if (tradingLoopConfig.decisionMinutes.indexOf(minuteOfLastCandlestick) === -1 &&
            tradingLoopConfig.decisionMinutes.indexOf(dateInFuture.getMinutes()) === -1) {
            return undefined;
        }

        const candlesticksCopy = cloneDeep(candleSticks);
        const candleSticksPercentageVariationsCopy = cloneDeep(candleSticksPercentageVariations);
        // to be able to use same indexes when starting earlier than defined minutes
        // because if we start earlier, there is no c0
        if (tradingLoopConfig.decisionMinutes.indexOf(minuteOfLastCandlestick) !== -1) {
            candlesticksCopy.pop();
            candleSticksPercentageVariationsCopy.pop();
        }

        const c1 = StrategyUtils.getCandleStick(candlesticksCopy, 0);
        const c2 = StrategyUtils.getCandleStick(candlesticksCopy, 1);
        const c1Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 0);
        const c2Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 1);
        const twentyFiveCandlesticksExcept2 = candlesticksCopy.slice(candlesticksCopy.length - 25 - 2, -2); // except the last 2
        const twentyCandlesticksExcept5 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 5, -5); // except the last 5
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticksExcept5);
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticksExcept5[0][4],
            twentyCandlesticksExcept5[twentyCandlesticksExcept5.length - 1][4]));

        // if before last candle percent change is below minimal threshold
        if (c1Variation < 1.4) {
            return undefined;
        }

        // if before last candle percent change is above maximal threshold
        if (c1Variation > 12) {
            return undefined;
        }

        // if before before last candle percent change is below minimal threshold
        if (c2Variation < 1) {
            return undefined;
        }

        // if before before last candle percent change is above maximal threshold
        if (c2Variation > 7) {
            return undefined;
        }


        // c2 close must be > c3..25 high
        if (twentyFiveCandlesticksExcept2.some(candle => candle[2] > c2[4])) {
            return undefined;
        }

        // v1 must be >= 1.2 * v2..25
        if (c1[5] < 1.2 * c2[5] ||
            twentyFiveCandlesticksExcept2.some(candle => c1[5] < 1.2 * candle[5])) {
            return undefined;
        }

        // if the line is not +/- horizontal
        // the variation of the 20 candlesticks should not be bigger than 5%
        if (maxVariation > 5) {
            return undefined;
        }

        // the variation of the first and last in the 20 candlesticks should not be bigger than 5% // TODO 5 or 3?
        if (edgeVariation > 5) {
            return undefined;
        }
        return { market, interval: this.INTERVAL, maxVariation, edgeVariation, volumeRatio: c1[5] / c2[5] };
    }
}