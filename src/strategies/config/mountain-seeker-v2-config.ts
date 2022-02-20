import { BaseStrategyConfig } from "../../models/strategy";
import { Currency } from "../../enums/trading-currencies.enum";

export type MountainSeekerV2Config = BaseStrategyConfig & {
    /** Markets that will be filtered out and never be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    ignoredMarkets?: Array<string>;

    /** Markets that can be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    authorizedMarkets?: Array<string>;

    /** Markets sorted by priority, from high to low.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    privilegedMarkets?: Array<string>;

    /** The currencies that the strategy is allowed to use for trading */
    authorizedCurrencies?: Array<Currency>;

    /** Used to keep only those markets that have at least this number of percentage variation
     * in last 24 hours. Can be negative */
    minimumPercentFor24hVariation?: number;

    tradingLoopConfig: TradingLoopConfig;
}

/** This configuration can be different for each candlestick interval */
export type TradingLoopConfig = {
    /** Seconds to sleep after buying */
    secondsToSleepAfterTheBuy: number;

    /** Loss in percentage after which the trading will stop.
     * Example: -10 stands for a loss of -10% */
    stopTradingMaxPercentLoss: number;

    /** Amount of seconds to sleep in the loop to monitor the price */
    priceWatchInterval: number;
}
