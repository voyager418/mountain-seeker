import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { container, singleton } from "tsyringe";
import { Squeeze } from "../strategies/squeeze";
import { SqueezeConfig } from "../strategies/config/squeeze-config";


/**
 * This service is responsible to start the appropriate trading strategy.
 */
@singleton()
export class TradingService {

    private strategy: StrategyDetails<SqueezeConfig> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.SQZ,
        config: {
            maxMoneyToTrade: 25,
            autoRestartOnProfit: true
        }
    }

    private account: Account = {
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET
    }

    public async beginTrading(): Promise<void> {
        container.resolve(Squeeze).setup(this.account, this.strategy);
    }

}
