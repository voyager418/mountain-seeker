import log from "../logging/log.instance";
import { MountainSeeker, MountainSeekerConfig } from "../strategies/mountain-seeker";
import { StrategyDetails } from "../models/strategy-details";
import { TradingStrategy } from "../enums/trading-strategy.enum";
import { TradingPlatform } from "../enums/trading-platform.enum";
import { Account } from "../models/account";
import { Service } from "typedi";
import { TradingState } from "../models/trading-state";

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
            maxMoneyToTrade: 12,
            autoRestartOnProfit: true
        }
    }

    private account: Account = {
        apiKey: process.env.BINANCE_API_KEY,
        apiSecret: process.env.BINANCE_API_SECRET
    }

    public async beginTrading(): Promise<void> {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            const defaultStrategy = new MountainSeeker(this.account, this.strategy);
            try {
                const result: TradingState = await defaultStrategy.run();
                if (result && result.endedWithoutErrors && this.strategy.config.autoRestartOnProfit) {
                    if (result.percentChange && result.marketSymbol) {
                        if (result.percentChange > 0) {
                            // TODO : change this to be able to reuse the same market after x minutes
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
                log.error("Trading was aborted due to an error.", new Error(e));
                break;
            }
        }
    }

}
