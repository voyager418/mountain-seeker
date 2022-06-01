import { Market, TOHLCVF } from "../../../models/market";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { SelectorResult } from "../selector.interface";
import { StrategyUtils } from "../../../utils/strategy-utils";
import { NumberUtils } from "../../../utils/number-utils";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { cloneDeep } from 'lodash';
import log from '../../../logging/log.instance';
import { StrategyName } from "../../../models/strategy";

/**
 * The only condition is a big c1 variation
 */
export class SelectBy5minV4 {
    private static readonly INTERVAL = CandlestickInterval.FIVE_MINUTES;
    private static readonly DECISION_MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

    /**
     *     . <-- current new candle c0, but in case the decision is taken earlier c0 does not exist
     *    | <-- big variation (c1)
     * _ _<-- small variations (c2 & c3)
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

        if (market.percentChangeLast24h! < -10) {
            return undefined;
        }

        const candlesticksCopy = cloneDeep(candleSticks);
        const candleSticksPercentageVariationsCopy = cloneDeep(candleSticksPercentageVariations);
        let past = false;

        // allowed to start 15 seconds earlier or 40 seconds late
        if (withoutLastCandle) {
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
        const c1Variation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariationsCopy, 0);
        const twentyCandlesticksExcept2 = candlesticksCopy.slice(candlesticksCopy.length - 20 - 2, -2); // except the last 2 (c1 & c2)
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticksExcept2);
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticksExcept2[0][4],
            twentyCandlesticksExcept2[twentyCandlesticksExcept2.length - 1][4]));

        // if before last candle percent change is below minimal threshold
        if (c1Variation < 8) {
            return undefined;
        }

        if (past) {
            log.debug("Late selection");
        }

        const BUSDVolumeLast5h = StrategyUtils.getOriginAssetVolume(candlesticksCopy.slice(candlesticksCopy.length - 60 - 1, -1)); // without counting v1
        const BUSDVolumeLast10h = StrategyUtils.getOriginAssetVolume(candlesticksCopy.slice(candlesticksCopy.length - 120 - 1, -1));

        log.debug(`Edge variation between ${twentyCandlesticksExcept2[0][4]} & ${twentyCandlesticksExcept2[twentyCandlesticksExcept2.length - 1][4]}`);
        log.debug(`twentyCandlesticksExcept2: ${JSON.stringify(twentyCandlesticksExcept2)}`);
        log.debug(`Market: ${JSON.stringify(market.symbol)}`);
        log.debug(`c1Variation: ${c1Variation}`);
        return { market, interval: this.INTERVAL, strategyCustomName, maxVariation, edgeVariation,
            volumeRatio: c1[5] / c2[5], c1MaxVarRatio: c1Variation/maxVariation, earlyStart: !past, BUSDVolumeLast5h, BUSDVolumeLast10h };
    }

    static isADecisionMinute(minute: number): boolean {
        return this.DECISION_MINUTES.indexOf(minute) !== -1;
    }
}