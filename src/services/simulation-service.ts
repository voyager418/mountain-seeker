import { Strategy } from "../models/strategy";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { Account, Emails } from "../models/account";
import { container, singleton } from "tsyringe";
import { MountainSeekerV2Config } from "../strategies/config/mountain-seeker-v2-config";
import { BinanceDataService } from "./observer/binance-data-service";
import { MountainSeekerV2 } from "../strategies/mountain-seeker-v2";


/**
 * This service is responsible to start the simulation strategies.
 */
@singleton()
export class SimulationService {

    private strategy: Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat1-15-15", // based on 15min candlesticks and takes a decision every 15min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 900, // 15min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2 // TODO change to 5 ?
            }
        }
    }

    private strategy4: Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat4-5-5", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 300, // 5min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
        }
    }

    private strategy5: Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat5-15-30", // based on 15min candlesticks and takes a decision every 15min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
        }
    }

    private strategy8: Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat8-5-10", // based on 5min candlesticks and takes a decision every 5min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 600, // 10min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
        }
    }

    private strategy9: Strategy<MountainSeekerV2Config> = {
        type: TradingStrategy.MSV2,
        customName: "strat9-30-30", // based on 5min candlesticks and takes a decision every 30min
        config: {
            autoRestart: true,
            simulation: true,
            tradingLoopConfig: {
                secondsToSleepAfterTheBuy: 1800, // 30min
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 2
            }
        }
    }

    public startSimulations(): void {
        for (const strategy of [this.strategy, this.strategy4, this.strategy5, this.strategy8, this.strategy9]) {
            const account: Account = {
                email: Emails.simulation,
                maxMoneyAmount: 1000,
                apiKey: process.env.BINANCE_API_KEY!,
                apiSecret: process.env.BINANCE_API_SECRET!,
                isActive: true,
                mailPreferences: {
                    onNewTrade: true,
                    onEndTrade: true
                },
                activeStrategies: [strategy]
            }
            container.resolve(MountainSeekerV2).setup(account);
        }
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
