import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { container, singleton } from "tsyringe";
import { MountainSeekerV2Config } from "../strategies/config/mountain-seeker-v2-config";
import { BinanceDataService } from "./observer/binance-data-service";
import { MountainSeekerV3 } from "../strategies/mountain-seeker-v3";
import { TwitterDataService } from "./observer/twitter-data-service";
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
                stopTradingMaxPercentLoss: -5
            }
            ]])
        }
    }

    private strategy2: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        customName: "strat2-15-10", // based on 15min candlesticks and takes a decision every 10min
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIFTEEN_MINUTES, {
                secondsToSleepAfterTheBuy: 900, // 15min
                decisionMinutes: [0, 10, 20, 30, 40, 50],
                stopTradingMaxPercentLoss: -5
            }
            ]])
        }
    }

    private strategy3: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        customName: "strat3-15-5", // based on 15min candlesticks and takes a decision every 5min
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIFTEEN_MINUTES, {
                secondsToSleepAfterTheBuy: 900, // 15min
                decisionMinutes: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
                stopTradingMaxPercentLoss: -5
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
                stopTradingMaxPercentLoss: -5
            }
            ]])
        }
    }

    private strategyX: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV3,
        customName: "V3",
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true
        }
    }

    private account: Account = {
        email: process.env.RECEIVER_EMAIL_ADDRESS!,
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET
    }

    public beginTrading(): void {
        container.resolve(MountainSeekerV3).setup(this.account, this.strategyX);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy2);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy3);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy4);
    }

    public stopTrading(): string {
        const removeResult = container.resolve(BinanceDataService).removeAllObservers();
        const removeResult2 = container.resolve(TwitterDataService).removeAllObservers();
        return `${removeResult.removed + removeResult2.removed} strategies cancelled <br> ${removeResult.running + removeResult2.running} strategies still running`
    }

    public getStatus(): string {
        const status = container.resolve(BinanceDataService).getObserversStatus();
        const status2 = container.resolve(TwitterDataService).getObserversStatus();
        return `${status.total + status2.total} strategies are active <br> ${status.running + status2.running} strategies currently running`
    }
}
