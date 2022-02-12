import { BaseStrategyConfig } from "../../models/strategy";
import { Currency } from "../../enums/trading-currencies.enum";

export type MountainSeekerConfig = BaseStrategyConfig & {
    /** The maximum amount of money (in EUR) that a strategy is allowed to use for trading. */
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
    activeCandleStickIntervals?: Map<string, TradingLoopConfig>;

    /** Minimum trading volume of origin asset last 24h*/
    minimumTradingVolumeLast24h?: number;
}

/** This configuration can be different for each candlestick interval */
export type TradingLoopConfig = {
    /** Seconds to sleep during trading loop while monitoring the price.
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialSecondsToSleepInTheTradingLoop: number;

    /** Number in percent by which the stop limit price increases.
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialStopLimitPriceIncreaseInTheTradingLoop: number;

    /** For triggering a new stop limit order if the difference between current
     * unit price and current stop limit price becomes greater than this number (in %).
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialStopLimitPriceTriggerPercent: number;

    /** Seconds to sleep during trading loop while monitoring the price */
    secondsToSleepInTheTradingLoop: number;

    /** Number in percent by which the stop limit price increases (e.g. 1 for 1%) */
    stopLimitPriceIncreaseInTheTradingLoop: number;

    /** For triggering a new stop limit order if the difference between current
     * unit price and current stop limit price becomes greater than this number (in %) */
    stopLimitPriceTriggerPercent: number;

    /** Amount of seconds after which the trading is aborted if no profit is made
     * when the trading loop has started. -1 for infinity */
    stopTradingTimeoutSeconds: number;

    /** Loss in percentage after which the trading will stop.
     * Example: -10 stands for a loss of -10% */
    stopTradingMaxPercentLoss: number;
}