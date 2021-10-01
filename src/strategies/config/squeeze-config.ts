import { BaseStrategyConfig } from "../../models/strategy-details";
import { Currency } from "../../enums/trading-currencies.enum";
import { CandlestickInterval } from "../../enums/candlestick-interval.enum";

export type SqueezeConfig = BaseStrategyConfig & {
    /** The maximum amount of money (in USDT) that a strategy is allowed to use for trading. */
    maxMoneyToTrade: number;

    /** Markets that will be filtered out and never be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    ignoredMarkets?: Array<string>;

    /** Markets that can be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    authorizedMarkets?: Array<string>;

    /** The currencies that the strategy is allowed to use for trading.
     * Example: we want to buy on GAS/BTC market but we only have EUR in the wallet.
     * Therefore, the strategy will convert EUR to BTC */
    authorizedCurrencies?: Array<Currency>;

    /** Used to keep only those markets that have at least this number of percentage variation
     * in last 24 hours. Can be negative */
    minimumPercentFor24hVariation?: number;

    /** Intervals (e.g. '1m', '15m', '1h' ...) that will be used for selecting a market and their config */
    activeCandleStickIntervals?: Map<CandlestickInterval, TradingLoopConfig>;

    /** Minimum trading volume of origin asset last 24h*/
    minimumTradingVolumeLast24h?: number;

    /** Key is the name of the market, value is the date of the last finished trade.
     * This will allow to implement a logic to wait x amount of time between consecutive trades on
     * same market */
    marketLastTradeDate?: Map<string, Date>
}

/** This configuration can be different for each candlestick interval */
export type TradingLoopConfig = {
    /** Seconds to sleep during trading loop while monitoring the price.
     * FOR FIRST LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialSecondsToSleepInTheTradingLoop: number;

    /** Seconds to sleep during trading loop while monitoring the price */
    secondsToSleepInTheTradingLoop: number;

    /** Trail price expressed as a percentage below the current price (e.g. 1 for -1% below current price)
     * where the key is market name */
    trailPricePercent: Map<string, number>;

    /** Loss in percentage after which the trading will stop.
     * Example: -10 stands for a loss of -10% */
    stopTradingMaxPercentLoss: number;
}