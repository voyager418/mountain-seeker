import { singleton } from "tsyringe";
import { Selector, SelectorResult } from "../selector.interface";
import { Market } from "../../../models/market";
import { SelectBy5min } from "./select-by-5min";
import log from '../../../logging/log.instance';
import { StrategyUtils } from "../../../utils/strategy-utils";
import { MountainSeekerV2State } from "../../state/mountain-seeker-v2-state";
import { Strategy } from "../../../models/strategy";
import { MountainSeekerV2Config } from "../../config/mountain-seeker-v2-config";
import { Strat8510ReleaseSelector } from "./strat8-5-10-release-selector";
import { SelectBy5minV2 } from "./select-by-5min-v2";
import { SelectBy5minV3 } from "./select-by-5min-v3";
import { SelectBy30minV6 } from "./select-by-30min-v6";
import { SelectBy15minV2 } from "./select-by-15min-v2";
import { SelectBy5minV4 } from "./select-by-5min-v4";
import { Strat1855ReleaseSelector } from "./strat18-5-5-release-selector";


@singleton()
export class MarketSelector implements Selector {

    public isMarketEligible(state: MountainSeekerV2State, market: Market, strategy: Strategy<MountainSeekerV2Config>): SelectorResult | undefined {
        let shouldSelect;
        switch (strategy.customName) {
        case "strat4-5-5":
        case "strat8-5-10":
            shouldSelect = SelectBy5min.shouldSelectMarket(state, market, strategy.customName, true);
            break;
        case "strat10-5-5":
        case "strat10-5-10":
            shouldSelect = SelectBy5minV2.shouldSelectMarket(state, market, strategy.customName, true);
            break;
        case "strat15-5-5":
        case "strat15-5-10":
            shouldSelect = SelectBy5minV3.shouldSelectMarket(state, market, strategy.customName, true);
            break;
        case "strat16-30-30":
            shouldSelect = SelectBy30minV6.shouldSelectMarket(state, market, strategy.customName, true);
            break;
        case "strat17-15-15":
        case "strat20-15-30":
            shouldSelect = SelectBy15minV2.shouldSelectMarket(state, market, strategy.customName, true);
            break;
        case "strat18-5-5":
        case "strat19-5-10":
            shouldSelect = SelectBy5minV4.shouldSelectMarket(state, market, strategy.customName, true);
            break;

        case "strat8-5-10-r":
            shouldSelect = Strat8510ReleaseSelector.shouldSelectMarket(state, market, strategy.customName, true);
            break;
        case "strat18-5-5-r":
            shouldSelect = Strat1855ReleaseSelector.shouldSelectMarket(state, market, strategy.customName, true);
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
            previousShouldSelect = SelectBy5min.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case "strat10-5-5":
        case "strat10-5-10":
            previousShouldSelect = SelectBy5minV2.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case "strat15-5-5":
        case "strat15-5-10":
            previousShouldSelect = SelectBy5minV3.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case "strat16-30-30":
            previousShouldSelect = SelectBy30minV6.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case "strat17-15-15":
        case "strat20-15-30":
            previousShouldSelect = SelectBy15minV2.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case "strat18-5-5":
        case "strat19-5-10":
            previousShouldSelect = SelectBy5minV4.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;

        case "strat8-5-10-r":
            previousShouldSelect = Strat8510ReleaseSelector.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            break;
        case "strat18-5-5-r":
            previousShouldSelect = Strat1855ReleaseSelector.shouldSelectMarket(state, market, strategy.customName, false,  candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
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