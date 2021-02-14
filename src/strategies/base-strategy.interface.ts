import { Account } from "../models/account";
import { TradingState } from "../models/trading-state";

/**
 * A trading strategy interface
 */
export interface BaseStrategy {
    /** Method which starts the trading based on a given strategy */
    run(account: Account): Promise<TradingState>;

    getTradingState(): TradingState;
}
