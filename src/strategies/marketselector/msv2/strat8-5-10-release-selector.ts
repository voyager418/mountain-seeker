import { Market, TOHLCVF } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { cloneDeep } from 'lodash';
import log from '../../../logging/log.instance';
import { StrategyName } from "../../../models/strategy";

export class Strat8510ReleaseSelector {
    private static readonly INTERVAL = CandlestickInterval.FIVE_MINUTES;
    private static readonly DECISION_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

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

        // allowed to start 15 seconds earlier or 40 seconds late
        if (shouldValidateDates) {
            const fetchingDateOfDefaultCandle = new Date(candlesticksCopy[candlesticksCopy.length - 1][6]!);
            if (fetchingDateOfDefaultCandle.getSeconds() === 0) {
                // because if the last candle was fetched at 59 seconds, it could be that the fetch date = 0 seconds
                // and if that's the case then we have an incorrect perception of the situation
                return undefined;
            }
            let timeIsOk = false;
            const dateInFuture = new Date();
            dateInFuture.setSeconds(dateInFuture.getSeconds() + 15);
            const dateInPast = new Date();
            dateInPast.setSeconds(dateInPast.getSeconds() - 41);

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
        const twentyFiveCandlesticksExcept2 = candlesticksCopy.slice(candlesticksCopy.length - 25 - 2, -2); // except the last 2
        const twentyCandlesticksExcept5 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 5, -5); // except the last 5
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticksExcept5);
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticksExcept5[0][4],
            twentyCandlesticksExcept5[twentyCandlesticksExcept5.length - 1][4]));
        const c1MaxVarRatio = c1Variation/maxVariation;

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

        if (shouldValidateDates) {
            // aws log insights conditions
            const shouldSelect =
                // (c1_variation <= 4 and max_variation <= 1.5 and chg_24h <= 15 and BUSD_volume_last_24h >= 550000 and c2_variation >= 1.4 and c2_variation <= 5 and volume_ratio <= 8)
                (c1Variation <= 4 && maxVariation <= 1.5 && market.percentChangeLast24h! <= 15 && market.originAssetVolumeLast24h! >= 550000 && c2Variation >= 1.4 && c2Variation <= 5 && volumeRatio <= 8)
                // (edge_variation <= 1 and max_variation <= 1.5 and max_variation > 1 and BUSD_volume_last_24h >= 600000 and volume_ratio <= 8 and c2_variation >= 1.7)
                || (edgeVariation <= 1 && maxVariation <= 1.5 && maxVariation > 1 && market.originAssetVolumeLast24h! >= 600000 && volumeRatio <= 8 && c2Variation >= 1.7)
                // (max_variation <= 3 and max_variation >= 1 and edge_variation <= 1 and volume_ratio <= 8 and chg_24h <= 15 and volume_ratio >= 2.6 and c1_variation >= 2.5)
                || (maxVariation <= 3 && maxVariation >= 1 && edgeVariation <= 1 && volumeRatio <= 8 && market.percentChangeLast24h! <= 15 && volumeRatio >= 2.6 && c1Variation >= 2.5)
                // (c1_max_var_ratio >= 2.5 and volume_ratio >= 2 and volume_ratio <= 3 and edge_variation <= 2 and c1_variation >= 1.8)
                || (c1MaxVarRatio >= 2.5 && volumeRatio >= 2 && volumeRatio <= 3 && edgeVariation <= 2 && c1Variation >= 1.8)
                // (max_variation <= 3 and max_variation >= 1 and edge_variation <= 1 and volume_ratio <= 12 and chg_24h <= 15 and chg_24h > 2 and volume_ratio >= 2.9)
                || (maxVariation <= 3 && maxVariation >= 1 && edgeVariation <= 1 && volumeRatio <= 12 && market.percentChangeLast24h! <= 15 && market.percentChangeLast24h! > 2 && volumeRatio >= 2.9)

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
                c1MaxVarRatio = ${c1MaxVarRatio}
            `);
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