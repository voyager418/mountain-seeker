import { singleton } from "tsyringe";
import { Selector, SelectorResult } from "../selector.interface";
import { CandlestickInterval } from "../../../enums/candlestick-interval.enum";
import { Market } from "../../../models/market";
import { SelectBy5min } from "./select-by-5min";
import log from '../../../logging/log.instance';
import { StrategyUtils } from "../../../utils/strategy-utils";
import { SelectBy15min } from "./select-by-15min";
import { SelectBy30min } from "./select-by-30min";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";


@singleton()
export class MarketSelector implements Selector {

    public isMarketEligible(state: MountainSeekerV2State, market: Market, interval: CandlestickInterval): SelectorResult | undefined {
        let shouldSelect;
        switch (interval) {
        case CandlestickInterval.FIVE_MINUTES:
            shouldSelect = SelectBy5min.shouldSelectMarket(state, market, market.candleSticks.get(interval)!, market.candleSticksPercentageVariations.get(interval)!, true);
            break;
        case CandlestickInterval.FIFTEEN_MINUTES:
            shouldSelect = SelectBy15min.shouldSelectMarket(state, market, market.candleSticks.get(interval)!, market.candleSticksPercentageVariations.get(interval)!, true);
            break;
        case CandlestickInterval.THIRTY_MINUTES:
            shouldSelect = SelectBy30min.shouldSelectMarket(state, market, market.candleSticks.get(interval)!, market.candleSticksPercentageVariations.get(interval)!, true);
            break;
        default:
            log.error(`Unable to select a market due to unknown or unhandled candlestick interval : ${interval}`);
        }
        if (!shouldSelect) {
            return undefined
        }

        const candleSticksExceptLast = StrategyUtils.getCandleSticksExceptLast(market, interval)
        const candleSticksPercentageVariationsExceptLast = StrategyUtils.getCandleSticksPercentVariationsExceptLast(market, interval);
        let previousShouldSelect;
        switch (interval) {
        case CandlestickInterval.FIVE_MINUTES:
            previousShouldSelect = SelectBy5min.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case CandlestickInterval.FIFTEEN_MINUTES:
            previousShouldSelect = SelectBy15min.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case CandlestickInterval.THIRTY_MINUTES:
            previousShouldSelect = SelectBy30min.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        default:
            log.error(`Unable to select a market due to unknown or unhandled candlestick interval : ${interval}`);
        }

        if (!previousShouldSelect) {
            return shouldSelect;
        }
        return undefined;
    }
}