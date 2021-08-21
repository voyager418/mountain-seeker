import { TradingState } from "../models/trading-state";
import { Observer } from "../services/observer/observer.interface";

/**
 * A trading strategy interface
 */
export interface BaseStrategy extends Observer {
    /**
     * Method which starts the trading based on a given strategy
     */
    run(): Promise<void>;

    /**
     * @return The current state of the running strategy
     */
    getState(): TradingState;
}
