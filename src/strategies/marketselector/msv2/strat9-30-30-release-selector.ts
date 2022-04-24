import { Market, TOHLCVF } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { cloneDeep } from 'lodash';
import log from "../../../logging/log.instance";
import { StrategyName } from "../../../models/strategy";

export class Strat93030ReleaseSelector {
    private static readonly INTERVAL = CandlestickInterval.THIRTY_MINUTES;
    private static readonly DECISION_MINUTES = [0, 30];

    /**
     *      . <-- current new candle c0, but in case the decision is taken earlier c0 does not exist
     *     | <-- big variation (c1) with a big volume (v1)
     *    | <-- big variation (c2)
     * _ _<-- small variations (c3 & c4)
     */
    static shouldSelectMarket(state: MountainSeekerV2State, market: Market, candleSticks: Array<TOHLCVF>,
        candleSticksPercentageVariations: Array<number>, strategyCustomName: StrategyName, withoutLastCandle?: boolean): SelectorResult | undefined {
        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = state.marketLastTradeDate!.get(market.symbol + strategyCustomName);
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

        if (withoutLastCandle) {
            const fetchingDateOfDefaultCandle = new Date(candlesticksCopy[candlesticksCopy.length - 1][6]!);
            if (fetchingDateOfDefaultCandle.getSeconds() === 0) {
                // because if the last candle was fetched at 59 seconds, it could be that the fetch date = 0 seconds
                // and if that's the case then we have an incorrect perception of the situation
                return undefined;
            }
            let timeIsOk = false;
            const dateInFuture = new Date();
            dateInFuture.setSeconds(dateInFuture.getSeconds() + 30);
            const dateInPast = new Date();
            dateInPast.setSeconds(dateInPast.getSeconds() - 11); // if the current time is 02:30:10, 11 seconds in past wasn't a decision minute so we might start

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
        const volumeRatio = c1[5] / c2[5];
        const c1Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 0);
        const c2Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 1);
        const c3Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 2);
        const twentyCandlesticksExcept2 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 2, -2); // the 2 that had a big variation
        const twentyCandlesticksExcept5 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 5, -5);
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticksExcept5);
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticksExcept5[0][4],
            twentyCandlesticksExcept5[twentyCandlesticksExcept5.length - 1][4]));
        const c1MaxVarRatio = c1Variation / maxVariation;

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

        if (withoutLastCandle) {
            // aws log insights conditions
            const shouldSelect =
                // volume_ratio >= 1.5 and volume_ratio < 20 and c1_variation >= 2 and c3_variation < 4
                // and ((c2_variation >= 2 and c2_variation < 3 and ((volume_ratio >= 8 and c1_variation > 6) or (volume_ratio > 2 and c1_variation >= 5.6)))
                // or (c2_variation >= 3))
                // and ((c1_max_var_ratio >= 0.7 and c1_variation > c2_variation) or c1_max_var_ratio >= 1)
                // and (c1_variation / c2_variation >= 2 or c2_variation / c1_variation >= 1.5)
                volumeRatio >= 1.5 && volumeRatio < 20 && c1Variation >= 2 && c3Variation < 4 &&
                ((c2Variation >= 2 && c2Variation < 3 && ((volumeRatio >= 8 && c1Variation > 6) || (volumeRatio > 2 && c1Variation >= 5.6))) ||
                    (c2Variation >= 3)) &&
                ((c1MaxVarRatio >= 0.7 && c1Variation > c2Variation) || c1MaxVarRatio >= 1) &&
                (c1Variation / c2Variation >= 2 || c2Variation / c1Variation >= 1.5);
            if (!shouldSelect) {
                return undefined;
            }

            log.debug(`c1Variation/c2Variation = ${c1Variation / c2Variation},
                volumeRatio = ${volumeRatio},
                maxVariation = ${maxVariation},
                edgeVariation = ${edgeVariation},
                market.percentChangeLast24h = ${market.percentChangeLast24h},
                market.originAssetVolumeLast24h = ${market.originAssetVolumeLast24h!},
                c1Variation = ${c1Variation},
                c2Variation = ${c2Variation},
                c1Variation/maxVariation = ${c1Variation / maxVariation}
            `);
        }

        if (past) {
            log.debug("Late selection");
        }

        const BUSDVolumeLast5h = StrategyUtils.getOriginAssetVolume(candlesticksCopy.slice(candlesticksCopy.length - 10 - 1, -1)); // without counting v1
        const BUSDVolumeLast10h = StrategyUtils.getOriginAssetVolume(candlesticksCopy.slice(candlesticksCopy.length - 20 - 1, -1));

        return { market, interval: this.INTERVAL, strategyCustomName, maxVariation, edgeVariation, volumeRatio, c1MaxVarRatio: c1Variation/maxVariation, earlyStart: !past, BUSDVolumeLast5h, BUSDVolumeLast10h };
    }

    static isADecisionMinute(minute: number): boolean {
        return this.DECISION_MINUTES.indexOf(minute) !== -1;
    }
}