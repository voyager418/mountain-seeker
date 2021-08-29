import { CandlestickInterval } from "../enums/candlestick-interval.enum";

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
    profitPercent?: number;
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
    /** The market price percent change last 24h */
    marketPercentChangeLast24h?: number;
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
     * So ZY = "CAKE/BNB".
     * This number corresponds to the price variation between the first BUY order and the current price. */
    pricePercentChangeOnZY?: number;
    /** Corresponds to the profit in percent by calculating the difference between
     * the amount of Y bought and amount of Y received when selling Z */
    profitOnZY?: number;
    /** Amount of Y that was bought and that will be used to buy Z */
    amountOfYBought?: number;
    /** Amount of Y used to buy Z */
    amountOfYSpentOnZ?: number;
    /** The candlestick interval that is being used by a strategy */
    selectedCandleStickInterval?: CandlestickInterval;
    /** Binance allows to convert small amounts to BNB. This value represents the amount
     * of BNB retrieved after converting the small amounts. */
    profitBNB?: number;
}