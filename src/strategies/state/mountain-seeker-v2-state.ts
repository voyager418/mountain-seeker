import { TradingState } from "./trading-state";
import { TOHLCVF } from "../../models/market";


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
    /** The market price percent change last 24h */
    marketPercentChangeLast24h?: number;
    /** Last 5 candlesticks percentage variations */
    last5CandleSticksPercentageVariations?: Array<number>;
    /** Last 5 candlesticks */
    last5CandleSticks?: Array<TOHLCVF>;
    /** The maximum possible percentage gain */
    runUp?: number;
    /** The maximum possible loss of the trade (without taking into account the max loss %) */
    drawDown?: number;
    /** Amount of Y that was bought */
    amountOfYBought?: number;
    /** Key is the name of the market, value is the date of the last finished trade.
     * This will allow to implement a logic to wait x amount of time between consecutive trades on
     * same market */
    marketLastTradeDate?: Map<string, Date>; // TODO: does not work if server restarts
    /** Percent profit of previous trade */
    profitOfPreviousTrade?: number; // TODO: does not work if server restarts
}