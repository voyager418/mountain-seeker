import { Account } from "../models/account";
import { TradingState } from "../models/trading-state";

/**
 * A trading strategy interface
 */
export interface BaseStrategy {
    /**
     * Method which starts the trading based on a given strategy
     *
     * @return A promise with the final trading state
     */
    run(account: Account): Promise<TradingState>;
}
