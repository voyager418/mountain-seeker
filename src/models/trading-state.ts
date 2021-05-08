import { StrategyDetails } from "./strategy-details";

/**
 * Represents trading progress state and statistics
 */
export type TradingState = {
    /** Identifier of the trading strategy that is being executed */
    id: string;
    /** User's wallet balance for before starting the trading */
    initialWalletBalance?: string;
    /** Updated user's wallet balance after refill */
    refilledWalletBalance?: string;
    /** User's wallet balance when trading finished */
    endWalletBalance?: string;
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
    marketSymbol?: string;
    /** Array of candlesticks percentage variations */
    candleSticksPercentageVariations?: Array<number>;
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
    pricePercentChangeOnYX?: number;
    /** For example : if trading market is "CAKE/BNB", then X = EUR, Y = BNB and Z = CAKE.
     * So ZY = "CAKE/BNB" */
    pricePercentChangeOnZY?: number;
    /** Amount of Y that was bought and that will be used to buy Z */
    amountOfYBought?: number
    /** Amount of Y used to buy Z */
    amountOfYSpentOnZ?: number
    /** Parameters of the strategy */
    config?: StrategyDetails<any>;
}