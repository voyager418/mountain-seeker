import { Currency } from "../enums/trading-currencies.enum";
import { Market } from "./market";
import { Order } from "./order";
import { BaseStrategyConfig, StrategyDetails } from "./strategy-details";

/**
 * Represents trading progress state and statistics
 */
export type TradingState = {
    /** Identifier of the trading strategy that is being executed */
    id: string;
    /** User's wallet balance for before starting the trading */
    initialWalletBalance?: Map<Currency, number>;
    /** Updated user's wallet balance after refill */
    refilledWalletBalance?: Map<Currency, number>;
    /** User's wallet balance when trading finished */
    endWalletBalance?: Map<Currency, number>;
    /** Indicates the made profit in %, can be negative */
    percentChange?: number;
    /** Indicates the made profit in €, can be negative */
    profitEuro?: number;
    /** The amount in EUR that was put in the market */
    investedAmountOfEuro?: number;
    /** The amount in EUR that was retrieved at the end of the trade */
    retrievedAmountOfEuro?: number;
    /** The number of open positions */
    openOrders?: number;
    /** Indicates whether the market accepts EUR currency (which is used to buy {@link Market.targetAsset}) */
    originAssetIsEur?: boolean;
    /** The market where the trading is happening */
    market?: Market;
    /** First BUY order when the trading starts */
    firstBuyOrder?: Order;
    /** All STOP LIMIT orders that are made */
    stopLimitOrders?: Array<Order>;
    /** Indicates whether the trading ended without problems */
    endedWithoutErrors?: boolean;
    /** For example : if trading market is "CAKE/BNB", then X = EUR, Y = BNB and Z = CAKE.
     * So YX = "BNB/EUR" */
    initialUnitPriceOnYXMarket?: number;
    /** For example : if trading market is "CAKE/BNB", then X = EUR, Y = BNB and Z = CAKE.
     * So YX = "BNB/EUR" */
    endUnitPriceOnYXMarket?: number;
    /** For example : if trading market is "CAKE/BNB", then X = EUR, Y = BNB and Z = CAKE.
     * So YX = "BNB/EUR" */
    percentChangeOnYX?: number;
    /** Parameters of the strategy */
    config?: StrategyDetails<any>;
}