/**
 * Represents the current trading progress state
 */
export type TradingState = {
    /** Identifier of the trading strategy that is being executed */
    id: string;
    /** Actual user's wallet balance (in €) */
    walletBalance?: number;
    /** Indicates if any profit was made (in %), can be negative */
    profit?: number;
    /** The number of open positions */
    openOrders?: number;
}