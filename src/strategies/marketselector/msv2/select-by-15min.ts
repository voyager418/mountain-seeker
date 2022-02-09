import { Market, TOHLCV } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { cloneDeep } from 'lodash';
import log from "../../../logging/log.instance";

export class SelectBy15min {
    private static readonly INTERVAL = CandlestickInterval.FIFTEEN_MINUTES;
    private static readonly DECISION_MINUTES = [0, 15, 30, 45];

    static shouldSelectMarket(state: MountainSeekerV2State, market: Market, candleSticks: Array<TOHLCV>,
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

        // allowed to start only 45 seconds earlier or 45 seconds late
        const currentDate = new Date();
        let timeIsOk = false;
        const dateInFuture = new Date();
        dateInFuture.setSeconds(dateInFuture.getSeconds() + 45);
        const dateInPast = new Date();
        dateInPast.setSeconds(dateInPast.getSeconds() - 46);

        let past = false;
        let future = false;
        if (!this.isADecisionMinute(currentDate.getMinutes()) && this.isADecisionMinute(dateInFuture.getMinutes())) {
            timeIsOk = true;
            future = true;
        }

        if(!timeIsOk && this.isADecisionMinute(currentDate.getMinutes()) && !this.isADecisionMinute(dateInPast.getMinutes())) {
            timeIsOk = true;
            past = true;
        }

        if(!timeIsOk) {
            return undefined;
        }

        const candlesticksCopy = cloneDeep(candleSticks);
        const candleSticksPercentageVariationsCopy = cloneDeep(candleSticksPercentageVariations);
        let popped = false;

        // to be able to use same indexes when starting earlier than defined minutes
        // because if we start earlier, there is no c0
        if (this.isADecisionMinute(currentDate.getMinutes())) {
            popped = true;
            candlesticksCopy.pop();
            candleSticksPercentageVariationsCopy.pop();
        }

        const c1 = StrategyUtils.getCandleStick(candlesticksCopy, 0);
        const c2 = StrategyUtils.getCandleStick(candlesticksCopy, 1);
        const c1Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 0);
        const c2Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 1);
        const twentyCandlesticksExcept2 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 2, -2);
        const twentyCandlesticksExcept5 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 5, -5); // except the last 5
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticksExcept5);
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticksExcept5[0][4],
            twentyCandlesticksExcept5[twentyCandlesticksExcept5.length - 1][4]));

        // if before last candle percent change is below minimal threshold
        if (c1Variation < 2) {
            return undefined;
        }

        // if before last candle percent change is above maximal threshold
        if (c1Variation > 20) {
            return undefined;
        }


        // if before before last candle percent change is below minimal threshold
        if (c2Variation < 1.2) {
            return undefined;
        }

        // if before before last candle percent change is above maximal threshold
        if (c2Variation > 10) {
            return undefined;
        }

        // c2 close must be > c3..20 high
        if (twentyCandlesticksExcept2.some(candle => candle[2] > c2[4])) {
            return undefined;
        }

        // v1 must be >= 1.2 * v2..20
        if (c1[5] < 1.2 * c2[5] ||
            twentyCandlesticksExcept2.some(candle => c1[5] < 1.2 * candle[5])) {
            return undefined;
        }

        if (popped) {
            log.debug("popped");
        }
        if (future) {
            log.debug("future");
        }
        if (past) {
            log.debug("past");
        }
        return { market, interval: this.INTERVAL, maxVariation, edgeVariation, volumeRatio: c1[5] / c2[5] };
    }

    static isADecisionMinute(minute: number) {
        return this.DECISION_MINUTES.indexOf(minute) !== -1;
    }
}