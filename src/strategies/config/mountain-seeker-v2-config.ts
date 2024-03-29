import { BaseStrategyConfig, Strategy, StrategyName } from "../../models/strategy";
import { Currency } from "../../enums/trading-currencies.enum";
import { TradingStrategy } from "../../enums/trading-strategy.enum";

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

    /** If true then it's a short */
    short?: boolean;
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

    /** Take profit in percent */
    takeProfit?: number;
}

export class Strategies {
    static readonly strat4_5_5 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat4-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat8_5_10 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat8-5-10", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 600, // 10min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat10_5_5 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat10-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat10_5_10 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat10-5-10", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 600, // 10min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat15_5_5 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat15-5-5",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat15_5_10 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat15-5-10",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 600, // 10min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat16_30_30 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat16-30-30",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat17_15_15 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat17-15-15", // based on 15min candlesticks and takes a decision every 15min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 900, // 15min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat18_5_5 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat18-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat19_5_10 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat19-5-10",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 600, // 10min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }

    static readonly strat20_15_30 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat20-15-30",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15
            }
        }
    }



    static readonly strat8_5_10_r : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat8-5-10-r",
        config: {
            autoRestart: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 600, // 10min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15,
                takeProfit: 4
            }
        }
    }

    static readonly strat18_5_5_r : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat18-5-5-r",
        config: {
            autoRestart: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10,
                takeProfit: 11.19
            }
        }
    }

    public static getStrategy(customName: StrategyName): Strategy<MountainSeekerV2Config> {
        switch (customName) {
        case "strat4-5-5":
            return Strategies.strat4_5_5;
        case "strat8-5-10":
            return Strategies.strat8_5_10;
        case "strat10-5-5":
            return Strategies.strat10_5_5;
        case "strat10-5-10":
            return Strategies.strat10_5_10;
        case "strat15-5-5":
            return Strategies.strat15_5_5;
        case "strat15-5-10":
            return Strategies.strat15_5_10;
        case "strat16-30-30":
            return Strategies.strat16_30_30;
        case "strat17-15-15":
            return Strategies.strat17_15_15;
        case "strat18-5-5":
            return Strategies.strat18_5_5;
        case "strat19-5-10":
            return Strategies.strat19_5_10;
        case "strat20-15-30":
            return Strategies.strat20_15_30;

        case "strat8-5-10-r":
            return Strategies.strat8_5_10_r;
        case "strat18-5-5-r":
            return Strategies.strat18_5_5_r;
        default:
            throw new Error("Strategy not found");
        }
    }

}
