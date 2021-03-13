import { Currency } from "../enums/trading-currencies.enum";

/**
 * Represents the current trading progress state
 */
export type TradingState = {
    /** Identifier of the trading strategy that is being executed */
    id: string;
    /** Actual user's wallet balance for different assets */
    walletBalance?: Map<Currency, number>;
    /** Indicates the made profit in %, can be negative */
    profitPercent?: number;
    /** Indicates the made profit in €, can be negative */
    profitEuro?: number;
    /** The number of open positions */
    openOrders?: number;
}