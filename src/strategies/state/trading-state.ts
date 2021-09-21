
/**
 * Represents trading progress state and statistics
 */
export type TradingState = {
    /** Identifier of the trading strategy that is being executed */
    id: string;
    /** The market where the trading is happening */
    marketSymbol?: string;
}