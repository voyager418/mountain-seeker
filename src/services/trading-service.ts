import log from "../logging/log.instance";
import { MountainSeeker, MountainSeekerConfig } from "../strategies/mountain-seeker";
import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { TradingState } from "../models/trading-state";
import { EmailService } from "./email-service";
import { container, singleton } from "tsyringe";


/**
 * This service is responsible to start the appropriate trading strategy.
 */
@singleton()
export class TradingService {

    private strategy: StrategyDetails<MountainSeekerConfig> = {
        platform: TradingPlatform.BINANCE,
        type: TradingStrategy.MS,
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
        let errorMessage;
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const defaultStrategy = container.resolve(MountainSeeker).setup(this.account, this.strategy);
            errorMessage = "";
            try {
                const result: TradingState = await defaultStrategy.run();
                if (result && result.endedWithoutErrors && result.marketSymbol && this.strategy.config.autoRestartOnProfit) {
                    this.strategy.config.ignoredMarkets = [result.marketSymbol];
                    if (result.percentChange) {
                        if (result.percentChange <= -10) {
                            log.warn("Loss of %O%", result.percentChange);
                            break;
                        }
                    } else {
                        log.warn(`Something went wrong. ${JSON.stringify(result)}`);
                        break;
                    }
                }
            } catch (e) {
                const error = new Error(e);
                log.error("Trading was aborted due to an error : ", error);
                errorMessage = error.message;
                break;
            }
        }
        await container.resolve(EmailService).sendEmail("Trading stopped...", errorMessage);
    }

}
