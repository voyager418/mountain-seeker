import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
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
        type: TradingStrategy.MSV2,
        customName: "strat1-15-15", // based on 15min candlesticks and takes a decision every 15min
        config: {
            maxMoneyToTrade: 25,
            autoRestart: true,
            simulation: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIFTEEN_MINUTES, {
                secondsToSleepAfterTheBuy: 900, // 15min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2 // TODO change to 5 ?
            }
            ]])
        }
    }

    private strategy4: StrategyDetails<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat4-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            maxMoneyToTrade: 25,
            autoRestart: true,
            simulation: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIVE_MINUTES, {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
            ]])
        }
    }

    private strategy5: StrategyDetails<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat5-15-30", // based on 15min candlesticks and takes a decision every 15min
        config: {
            maxMoneyToTrade: 25,
            autoRestart: true,
            simulation: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIFTEEN_MINUTES, {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
            ]])
        }
    }

    private strategy8: StrategyDetails<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat8-5-10", // based on 5min candlesticks and takes a decision every 5min
        config: {
            maxMoneyToTrade: 25,
            autoRestart: true,
            simulation: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.FIVE_MINUTES, {
                secondsToSleepAfterTheBuy: 600, // 10min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
            ]])
        }
    }

    private strategy9: StrategyDetails<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat9-30-30", // based on 5min candlesticks and takes a decision every 30min
        config: {
            maxMoneyToTrade: 25,
            autoRestart: true,
            simulation: true,
            activeCandleStickIntervals: new Map([[CandlestickInterval.THIRTY_MINUTES, {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
            ]])
        }
    }

    private account: Account = {
        email: "simulation",
        maxMoneyAmount: 1000,
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET,
        mailPreferences: {
            onNewTrade: true,
            onEndTrade: true
        }
    }

    public beginTrading(): void {
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy4);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy5);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy8);
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy9);
        // last strategy name was strat9
    }

    public stopTrading(): any {
        return container.resolve(BinanceDataService).removeIdleObservers();
    }

    public getStatus(): any {
        const total = container.resolve(BinanceDataService).getTotalObservers();
        const running = container.resolve(BinanceDataService).getRunningObservers();
        return { total, running };
    }
}
