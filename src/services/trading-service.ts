import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { container, singleton } from "tsyringe";
import { MountainSeekerV2Config } from "../strategies/config/mountain-seeker-v2-config";
import { BinanceDataService } from "./observer/binance-data-service";
import { MountainSeekerV2 } from "../strategies/mountain-seeker-v2";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";


/**
 * This service is responsible to start the appropriate trading strategy.
 */
@singleton()
export class TradingService {

    private strategy: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        customName: "strat1-15-15", // based on 15min candlesticks and takes a decision every 15min
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIFTEEN_MINUTES, {
                secondsToSleepAfterTheBuy: 900, // 15min
                decisionMinutes: [0, 15, 30, 45],
                stopTradingMaxPercentLoss: -4.8
            }
            ]])
        }
    }

    private strategy4: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        customName: "strat4-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIVE_MINUTES, {
                secondsToSleepAfterTheBuy: 300, // 5min
                decisionMinutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
                stopTradingMaxPercentLoss: -4.8
            }
            ]])
        }
    }

    private strategy5: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        customName: "strat5-15-30", // based on 15min candlesticks and takes a decision every 15min
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIFTEEN_MINUTES, {
                secondsToSleepAfterTheBuy: 1800, // 30min
                decisionMinutes: [0, 15, 30, 45],
                stopTradingMaxPercentLoss: -4.8
            }
            ]])
        }
    }

    private strategy6: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        customName: "strat6-15-30", // based on 15min candlesticks and takes a decision every 15min
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true,
            simulation: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIFTEEN_MINUTES, {
                secondsToSleepAfterTheBuy: 1800, // 30min
                decisionMinutes: [0, 15, 30, 45],
                stopTradingMaxPercentLoss: -4.8
            }
            ]])
        }
    }

    private strategy7: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        customName: "strat7-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true,
            simulation: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIVE_MINUTES, {
                secondsToSleepAfterTheBuy: 300, // 5min
                decisionMinutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
                stopTradingMaxPercentLoss: -4.8
            }
            ]])
        }
    }

    private account: Account = {
        email: process.env.RECEIVER_EMAIL_ADDRESS!,
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET
    }

    public beginTrading(): void {
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy4);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy5);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy6);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy7);
    }

    public stopTrading(): string {
        const removeResult = container.resolve(BinanceDataService).removeAllObservers();
        return `${removeResult.removed} strategies cancelled <br> ${removeResult.running} strategies still running`
    }

    public getStatus(): string {
        const status = container.resolve(BinanceDataService).getObserversStatus();
        return `${status.total} strategies are active <br> ${status.running} strategies currently running`
    }
}
