import log from "../logging/log.instance";
import { MountainSeeker, MountainSeekerConfig } from "../strategies/mountain-seeker";
import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { Service } from "typedi";

/**
 * This service is responsible to start the appropriate trading strategy.
 *
 * TODO: a lot of things are hardcoded for the moment -> not good
 */
@Service()
export class TradingService {

    private strategy: StrategyDetails<MountainSeekerConfig> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MS,
        config: {
            maxMoneyToTrade: 1,
            autoRestartOnProfit: false
        }
    }

    private account: Account = {
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET
    }

    public async beginTrading(): Promise<void> {
        const defaultStrategy = new MountainSeeker(this.account, this.strategy);
        await defaultStrategy.run()
            .catch((e) => log.error("Trading was aborted.", new Error(e)));
    }

}
