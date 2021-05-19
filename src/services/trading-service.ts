import log from "../logging/log.instance";
import { MountainSeeker, MountainSeekerConfig } from "../strategies/mountain-seeker";
import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { Service } from "typedi";
import { TradingState } from "../models/trading-state";
import { EmailService } from "./email-service";

/**
 * This service is responsible to start the appropriate trading strategy.
 */
@Service()
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
            const defaultStrategy = new MountainSeeker(this.account, this.strategy);
            errorMessage = "";
            try {
                const result: TradingState = await defaultStrategy.run();
                if (result && result.endedWithoutErrors && this.strategy.config.autoRestartOnProfit) {
                    if (result.percentChange && result.marketSymbol) {
                        if (result.percentChange > -3) {
                            // TODO : maybe change this to be able to reuse the same market after x minutes
                            this.strategy.config.ignoredMarkets = [result.marketSymbol];
                        } else {
                            log.warn("Loss of %O%", result.percentChange);
                            break;
                        }
                    } else {
                        log.warn(`Something went wrong. ${JSON.stringify(result)}`);
                        break;
                    }
                }
            } catch (e) {
                log.error("Trading was aborted due to an error : ", new Error(e));
                errorMessage = e;
                break;
            }
        }
        await new EmailService().sendEmail("Trading stopped...", errorMessage);
    }

}
