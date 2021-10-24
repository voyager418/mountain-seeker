import { CandlestickInterval } from "../../enums/candlestick-interval.enum";
import { TradingState } from "./trading-state";


export type MountainSeekerV2State = TradingState & {
    /** User's wallet balance for before starting the trading */
    initialWalletBalance?: string;
    /** User's wallet balance when trading finished */
    endWalletBalance?: string;
    /** Indicates the made profit in %, can be negative */
    profitPercent?: number;
    /** Indicates the made profit in €, can be negative */
    profitUsdt?: number;
    /** The amount in USDT that was put in the market */
    investedAmountOfUsdt?: number;
    /** The amount in USDT that was retrieved at the end of the trade */
    retrievedAmountOfUsdt?: number;
    /** The number of open positions */
    openOrders?: number;
    /** The market price percent change last 24h */
    marketPercentChangeLast24h?: number;
    /** Array of candlesticks percentage variations */
    candleSticksPercentageVariations?: Array<number>;
    /** Indicates whether the trading ended without problems */
    endedWithoutErrors?: boolean;
    /** The maximum possible percentage gain */
    runUp?: number;
    /** The maximum possible loss of the trade (without taking into account the max loss %) */
    drawDown?: number;
    /** Amount of Y that was bought */
    amountOfYBought?: number;
    /** The candlestick interval that is being used by a strategy */
    selectedCandleStickInterval?: CandlestickInterval;
    /** Binance allows to convert small amounts to BNB. This value represents the amount
     * of BNB retrieved after converting the small amounts. */
    profitBNB?: number;
    takeProfitPrice?: number;
    stopLossPrice?: number;
}