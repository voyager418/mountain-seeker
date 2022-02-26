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
import { Strategy } from "../../../models/strategy";
import { MountainSeekerV2Config } from "../../config/mountain-seeker-v2-config";
import { Strat93030ReleaseSelector } from "./strat9-30-30-release-selector";
import { Strat8510ReleaseSelector } from "./strat8-5-10-release-selector";


@singleton()
export class MarketSelector implements Selector {

    public isMarketEligible(state: MountainSeekerV2State, market: Market, strategy: Strategy<MountainSeekerV2Config>): SelectorResult | undefined {
        let shouldSelect;
        switch (strategy.customName) {
        case "strat4-5-5":
        case "strat8-5-10":
            shouldSelect = SelectBy5min.shouldSelectMarket(state, market, market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!,
                market.candleSticksPercentageVariations.get(CandlestickInterval.FIVE_MINUTES)!, strategy.customName, true);
            break;
        case "strat1-15-15":
        case "strat5-15-30":
            shouldSelect = SelectBy15min.shouldSelectMarket(state, market, market.candleSticks.get(CandlestickInterval.FIFTEEN_MINUTES)!,
                market.candleSticksPercentageVariations.get(CandlestickInterval.FIFTEEN_MINUTES)!, strategy.customName, true);
            break;
        case "strat9-30-30":
            shouldSelect = SelectBy30min.shouldSelectMarket(state, market, market.candleSticks.get(CandlestickInterval.THIRTY_MINUTES)!,
                market.candleSticksPercentageVariations.get(CandlestickInterval.THIRTY_MINUTES)!, strategy.customName, true);
            break;

        case "strat9-30-30-release":
            shouldSelect = Strat93030ReleaseSelector.shouldSelectMarket(state, market, market.candleSticks.get(CandlestickInterval.THIRTY_MINUTES)!,
                market.candleSticksPercentageVariations.get(CandlestickInterval.THIRTY_MINUTES)!, strategy.customName, true);
            break;
        case "strat8-5-10-release":
            shouldSelect = Strat8510ReleaseSelector.shouldSelectMarket(state, market, market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!,
                market.candleSticksPercentageVariations.get(CandlestickInterval.FIVE_MINUTES)!, strategy.customName, true);
            break;
        default:
            log.error(`Unable to select a market due to unknown strategy name : ${strategy.customName}`);
        }
        if (!shouldSelect) {
            return undefined
        }

        const candleSticksExceptLast = StrategyUtils.getCandleSticksExceptLast(market, shouldSelect.interval)
        const candleSticksPercentageVariationsExceptLast = StrategyUtils.getCandleSticksPercentVariationsExceptLast(market, shouldSelect.interval);
        if (!shouldSelect.earlyStart) {
            // if we start late then we have to remove 2 candles in total
            candleSticksExceptLast.pop();
            candleSticksPercentageVariationsExceptLast.pop();
        }
        let previousShouldSelect;
        switch (strategy.customName) {
        case "strat4-5-5":
        case "strat8-5-10":
            previousShouldSelect = SelectBy5min.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast, strategy.customName);
            break;
        case "strat1-15-15":
        case "strat5-15-30":
            previousShouldSelect = SelectBy15min.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast, strategy.customName);
            break;
        case "strat9-30-30":
            previousShouldSelect = SelectBy30min.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast, strategy.customName);
            break;

        case "strat9-30-30-release":
            previousShouldSelect = Strat93030ReleaseSelector.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast, strategy.customName);
            break;
        case "strat8-5-10-release":
            previousShouldSelect = Strat8510ReleaseSelector.shouldSelectMarket(state, market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast, strategy.customName);
            break;
        default:
            log.error(`Unable to select a market due to unknown strategy name : ${strategy.customName}`);
        }

        if (!previousShouldSelect) {
            return shouldSelect;
        }
        return undefined;
    }
}