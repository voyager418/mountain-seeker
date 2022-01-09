import { CandlestickInterval } from "../../enums/candlestick-interval.enum";
import { TradingState } from "./trading-state";
import { TOHLCV } from "../../models/market";


export type MountainSeekerV2State = TradingState & {
    /** User's wallet balance for before starting the trading */
    initialWalletBalance?: string;
    /** User's wallet balance when trading finished */
    endWalletBalance?: string;
    /** Indicates the made profit in %, can be negative */
    profitPercent?: number;
    /** Indicates the money profit, can be negative */
    profitMoney?: number;
    /** The amount in BUSD that was put in the market */
    investedAmountOfBusd?: number;
    /** The amount in BUSD that was retrieved at the end of the trade */
    retrievedAmountOfBusd?: number;
    /** The number of open positions */
    openOrders?: number;
    /** The market price percent change last 24h */
    marketPercentChangeLast24h?: number;
    /** Last 5 candlesticks percentage variations */
    last5CandleSticksPercentageVariations?: Array<number>;
    /** Last 5 candlesticks */
    last5CandleSticks?: Array<TOHLCV>;
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
}