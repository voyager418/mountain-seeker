import { TradingState } from "../models/trading-state";
import { Observer } from "../services/observer/observer.interface";

/**
 * A trading strategy interface
 */
export interface BaseStrategy extends Observer {
    /**
     * Method which starts the trading based on a given strategy
     *
     * @return A promise with the final trading state
     */
    run(): Promise<TradingState>;

    /**
     * @return The current state of the running strategy
     */
    getState(): TradingState;
}
