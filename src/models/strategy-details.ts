import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";

/**
 * Information about the trading strategy
 */
export type StrategyDetails<T> = {
    type: TradingStrategy;
    platform: TradingPlatform;
    customName?: string;
    /** Strategy config which is a union of a custom config T and a base config */
    config: T & BaseStrategyConfig;
}

export type BaseStrategyConfig = {
    /** Indicates if the strategy should automatically restart
     * when it ends with a profit */
    autoRestartOnProfit?: boolean

    /** If set to `true` then no real orders will be made */
    simulation?: boolean;
}