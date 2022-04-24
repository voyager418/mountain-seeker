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
    static readonly strat1_15_15 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat1-15-15", // based on 15min candlesticks and takes a decision every 15min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 900, // 15min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10
            }
        }
    }

    static readonly strat4_5_5 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat4-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10
            }
        }
    }

    static readonly strat5_15_30 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat5-15-30", // based on 15min candlesticks and takes a decision every 15min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10
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
                priceWatchInterval: 10
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
                priceWatchInterval: 10
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
                priceWatchInterval: 10
            }
        }
    }

    static readonly strat9_30_30 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat9-30-30",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10
            }
        }
    }

    static readonly strat11_30_30 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat11-30-30",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10
            }
        }
    }

    static readonly strat12_30_30 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat12-30-30",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10
            }
        }
    }

    static readonly strat13_30_30 : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat13-30-30",
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 10
            }
        }
    }

    static readonly strat9_30_30_r : Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat9-30-30-r",
        config: {
            autoRestart: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 15,
                takeProfit: 13.3
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

    public static getStrategy(customName: StrategyName): Strategy<MountainSeekerV2Config> {
        switch (customName) {
        case "strat1-15-15":
            return Strategies.strat1_15_15;
        case "strat4-5-5":
            return Strategies.strat4_5_5;
        case "strat5-15-30":
            return Strategies.strat5_15_30;
        case "strat8-5-10":
            return Strategies.strat8_5_10;
        case "strat9-30-30":
            return Strategies.strat9_30_30;
        case "strat10-5-5":
            return Strategies.strat10_5_5;
        case "strat10-5-10":
            return Strategies.strat10_5_10;
        case "strat11-30-30":
            return Strategies.strat11_30_30;
        case "strat12-30-30":
            return Strategies.strat12_30_30;
        case "strat13-30-30":
            return Strategies.strat13_30_30;

        case "strat9-30-30-r":
            return Strategies.strat9_30_30_r;
        case "strat8-5-10-r":
            return Strategies.strat8_5_10_r;
        default:
            throw new Error("Strategy not found");
        }
    }

}
