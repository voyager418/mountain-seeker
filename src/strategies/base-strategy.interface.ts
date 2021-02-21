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

    /**
     * Each strategy should keep an internal state.
     * For example the current profit that the strategy is making.
     *
     * @return The current state
     */
    getTradingState(): TradingState;
}
