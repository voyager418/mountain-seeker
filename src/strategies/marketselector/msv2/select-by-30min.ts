import { Market, TOHLCVF } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { cloneDeep } from 'lodash';
import log from "../../../logging/log.instance";
import { StrategyName } from "../../../models/strategy";

export class SelectBy30min {
    private static readonly INTERVAL = CandlestickInterval.THIRTY_MINUTES;
    private static readonly DECISION_MINUTES = [0, 30];

    static shouldSelectMarket(state: MountainSeekerV2State, market: Market, candleSticks: Array<TOHLCVF>,
        candleSticksPercentageVariations: Array<number>, strategyCustomName: StrategyName, shouldValidateDates?: boolean): SelectorResult | undefined {
        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = state.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return undefined;
        }

        // should be in some range
        if (market.percentChangeLast24h! < -3 || market.percentChangeLast24h! > 35) {
            return undefined;
        }

        const candlesticksCopy = cloneDeep(candleSticks);
        const candleSticksPercentageVariationsCopy = cloneDeep(candleSticksPercentageVariations);
        let past = false;

        // allowed to start only 1 minute earlier or 1 minute late
        if (shouldValidateDates) {
            const fetchingDateOfDefaultCandle = new Date(candlesticksCopy[candlesticksCopy.length - 1][6]!);
            if (fetchingDateOfDefaultCandle.getSeconds() === 0) {
                // because if the last candle was fetched at 59 seconds, it could be that the fetch date = 0 seconds
                // and if that's the case then we have an incorrect perception of the situation
                return undefined;
            }
            let timeIsOk = false;
            const dateInFuture = new Date();
            dateInFuture.setSeconds(dateInFuture.getSeconds() + 60);
            const dateInPast = new Date();
            dateInPast.setSeconds(dateInPast.getSeconds() - 61);

            if (!this.isADecisionMinute(fetchingDateOfDefaultCandle.getMinutes()) && this.isADecisionMinute(dateInFuture.getMinutes())) {
                timeIsOk = true;
            }

            if (!timeIsOk && this.isADecisionMinute(fetchingDateOfDefaultCandle.getMinutes()) && !this.isADecisionMinute(dateInPast.getMinutes())) {
                timeIsOk = true;
                past = true;
            }

            if (!timeIsOk) {
                return undefined;
            }

            // to be able to use same indexes when starting earlier than defined minutes
            // because if we start earlier, there is no c0
            if (past) {
                candlesticksCopy.pop();
                candleSticksPercentageVariationsCopy.pop();
            }
        }

        const c1 = StrategyUtils.getCandleStick(candlesticksCopy, 0);
        const c2 = StrategyUtils.getCandleStick(candlesticksCopy, 1);
        const c1Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 0);
        const c2Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 1);
        const twentyCandlesticksExcept2 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 2, -2); // the 2 that had a big variation
        const twentyCandlesticksExcept5 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 5, -5);
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticksExcept5);
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticksExcept5[0][4],
            twentyCandlesticksExcept5[twentyCandlesticksExcept5.length - 1][4]));

        // if before last candle percent change is below minimal threshold
        if (c1Variation < 2) {
            return undefined;
        }

        // if before last candle percent change is above maximal threshold
        if (c1Variation > 30) {
            return undefined;
        }

        // if before before last candle percent change is below minimal threshold
        if (c2Variation < 2) {
            return undefined;
        }

        // if before before last candle percent change is above maximal threshold
        if (c2Variation > 30) {
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

        if (past) {
            log.debug("Late selection");
        }

        log.debug(`Edge variation between ${twentyCandlesticksExcept5[0][4]} & ${twentyCandlesticksExcept5[twentyCandlesticksExcept5.length - 1][4]}`);
        log.debug(`twentyCandlesticksExcept5: ${JSON.stringify(twentyCandlesticksExcept5)}`);
        log.debug(`Market: ${JSON.stringify(market.symbol)}`);
        return { market, interval: this.INTERVAL, strategyCustomName, maxVariation, edgeVariation, volumeRatio: c1[5] / c2[5], earlyStart: !past };
    }

    static isADecisionMinute(minute: number): boolean {
        return this.DECISION_MINUTES.indexOf(minute) !== -1;
    }
}