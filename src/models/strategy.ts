import { TradingStrategy } from "../enums/trading-strategy.enum";

/**
 * Information about the trading strategy
 */
export type Strategy<T> = {
    type: TradingStrategy;
    customName: StrategyName;
    /** Strategy config which is a union of a custom config T and a base config */
    config: T & BaseStrategyConfig;
    /** Any custom parameters used by the strategy. For analysis purposes */
    metadata?: any;
}

export type BaseStrategyConfig = {
    /** Indicates if the strategy should automatically restart after finishing a trade */
    autoRestart?: boolean

    /** If set to `true` then no real orders will be made */
    simulation?: boolean;
}

export type StrategyName = "strat1-15-15" | "strat4-5-5" | "strat5-15-30" | "strat8-5-10" | "strat9-30-30"
    | "strat9-30-30-r" | "strat8-5-10-r" | "strat10-5-5" | "strat10-5-10" | "strat11-30-30" | "strat12-30-30"
    | "strat13-30-30";