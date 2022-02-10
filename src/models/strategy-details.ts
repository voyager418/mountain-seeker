import { TradingStrategy } from "../enums/trading-strategy.enum";

/**
 * Information about the trading strategy
 */
export type StrategyDetails<T> = {
    type: TradingStrategy;
    customName?: string;
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