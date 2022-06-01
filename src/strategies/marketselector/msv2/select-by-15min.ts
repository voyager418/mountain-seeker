import { Market, TOHLCVF } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { cloneDeep } from 'lodash';
import log from "../../../logging/log.instance";
import { StrategyName } from "../../../models/strategy";

export class SelectBy15min {
    private static readonly INTERVAL = CandlestickInterval.FIFTEEN_MINUTES;
    private static readonly DECISION_MINUTES = [0, 15, 30, 45];

    /**
     *      . <-- current new candle c0, but in case the decision is taken earlier c0 does not exist
     *     | <-- big variation (c1) with a big volume (v1)
     *    | <-- big variation (c2)
     * _ _<-- small variations (c3 & c4)
     */
    static shouldSelectMarket(state: MountainSeekerV2State, market: Market,
        strategyCustomName: StrategyName, withoutLastCandle?: boolean, _candleSticks?: Array<TOHLCVF>,
        _candleSticksPercentageVariations?: Array<number>): SelectorResult | undefined {
        const candleSticks = _candleSticks ?? market.candleSticks.get(this.INTERVAL)!;
        const candleSticksPercentageVariations = _candleSticksPercentageVariations ?? market.candleSticksPercentageVariations.get(this.INTERVAL)!;

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

        // allowed to start only 45 seconds earlier or 45 seconds late
        if (withoutLastCandle) {
            const fetchingDateOfDefaultCandle = new Date(candlesticksCopy[candlesticksCopy.length - 1][6]!);
            if (fetchingDateOfDefaultCandle.getSeconds() === 0) {
                // because if the last candle was fetched at 59 seconds, it could be that the fetch date = 0 seconds
                // and if that's the case then we have an incorrect perception of the situation
                return undefined;
            }
            let timeIsOk = false;
            const dateInFuture = new Date();
            dateInFuture.setSeconds(dateInFuture.getSeconds() + 45);
            const dateInPast = new Date();
            dateInPast.setSeconds(dateInPast.getSeconds() - 46);

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
        // TODO compare with 11 instead of 20
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

        if (past) {
            log.debug("Late selection");
        }

        const BUSDVolumeLast5h = StrategyUtils.getOriginAssetVolume(candlesticksCopy.slice(candlesticksCopy.length - 20 - 1, -1)); // without counting v1
        const BUSDVolumeLast10h = StrategyUtils.getOriginAssetVolume(candlesticksCopy.slice(candlesticksCopy.length - 40 - 1, -1));

        log.debug(`Edge variation between ${twentyCandlesticksExcept5[0][4]} & ${twentyCandlesticksExcept5[twentyCandlesticksExcept5.length - 1][4]}`);
        log.debug(`twentyCandlesticksExcept5: ${JSON.stringify(twentyCandlesticksExcept5)}`);
        log.debug(`Market: ${JSON.stringify(market.symbol)}`);
        return { market, interval: this.INTERVAL, strategyCustomName, maxVariation, edgeVariation,
            volumeRatio: c1[5] / c2[5], c1MaxVarRatio: c1Variation/maxVariation, earlyStart: !past, BUSDVolumeLast5h, BUSDVolumeLast10h };
    }

    static isADecisionMinute(minute: number): boolean {
        return this.DECISION_MINUTES.indexOf(minute) !== -1;
    }
}