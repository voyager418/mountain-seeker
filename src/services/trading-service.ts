import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { container, singleton } from "tsyringe";
import { MountainSeekerV2 } from "../strategies/mountain-seeker-v2";
import { MountainSeekerV2Config } from "../strategies/config/mountain-seeker-v2-config";
import { BinanceDataService } from "./observer/binance-data-service";


/**
 * This service is responsible to start the appropriate trading strategy.
 */
@singleton()
export class TradingService {

    private strategy: StrategyDetails<MountainSeekerV2Config> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MSV2,
        config: {
            maxMoneyToTrade: 1000,
            autoRestartOnProfit: true
        }
    }

    private account: Account = {
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET
    }

    public beginTrading(): void {
        container.resolve(MountainSeekerV2).setup(this.account, this.strategy);
    }

    public stopTrading(): string {
        const removeResult = container.resolve(BinanceDataService).removeAllObservers();
        return `${removeResult.removed} strategies cancelled <br> ${removeResult.running} strategies still running`
    }

    public getStatus(): string {
        const status = container.resolve(BinanceDataService).getObserversStatus();
        return `${status.total} strategies are actif <br> ${status.running} strategies currently running`
    }
}
