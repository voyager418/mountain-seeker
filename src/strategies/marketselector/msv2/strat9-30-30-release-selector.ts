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
        candleSticksPercentageVariations: Array<number>, strategyCustomName: StrategyName, shouldValidateDates?: boolean): SelectorResult | undefined {
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
        const volumeRatio = c1[5] / c2[5];
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

        if (shouldValidateDates) {
            // aws log insights conditions
            const shouldSelect =
                // (c1_variation / c2_variation <= 3 and volume_ratio <= 12 and volume_ratio >= 5 and chg_24h <= 20 and edge_variation <= 5 and BUSD_volume_last_24h >= 1500000 and chg_24h >= 0)
                (c1Variation / c2Variation <= 3 && volumeRatio <= 12 && volumeRatio >= 5 && market.percentChangeLast24h! <= 20 && edgeVariation <= 5 && market.originAssetVolumeLast24h! >= 1500000 && market.percentChangeLast24h! >= 0)
                // or (c1_variation / c2_variation <= 3 and c1_variation / c2_variation >= 1.5 and max_variation <= 5 and edge_variation <= 2.5 and volume_ratio <= 4 and volume_ratio >= 1.5)
                || (c1Variation / c2Variation <= 3 && c1Variation / c2Variation >= 1.5 && maxVariation <= 5 && edgeVariation <= 2.5 && volumeRatio <= 4 && volumeRatio >= 1.5)
                // or (c1_variation / c2_variation <= 5 and volume_ratio <= 11 and max_variation <= 5 and c2_variation < c1_variation and c1_variation >= 6 and chg_24h <= 22 and c1_max_var_ratio >= 1.6)
                || (c1Variation / c2Variation <= 5 && volumeRatio <= 11 && maxVariation <= 5 && c2Variation < c1Variation && c1Variation >= 6 && market.percentChangeLast24h! <= 22 && c1Variation / maxVariation >= 1.6)
                // or (c1_max_var_ratio >= 1.7 and volume_ratio <= 10 and edge_variation <= 5)
                || (c1Variation / maxVariation >= 1.7 && volumeRatio <= 10 && edgeVariation <= 5);

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

        return { market, interval: this.INTERVAL, strategyCustomName, maxVariation, edgeVariation, volumeRatio, earlyStart: !past };
    }

    static isADecisionMinute(minute: number): boolean {
        return this.DECISION_MINUTES.indexOf(minute) !== -1;
    }
}