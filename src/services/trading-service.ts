import { container, singleton } from "tsyringe";
import { BinanceDataService } from "./observer/binance-data-service";
import { Account, Emails } from "../models/account";
import { MountainSeekerV2 } from "../strategies/mountain-seeker-v2";
import log from '../logging/log.instance';


/**
 * This service is responsible to start the appropriate trading strategy.
 */
@singleton()
export class TradingService {

    constructor(private binanceDataService: BinanceDataService) {}

    public stopTrading(): any {
        return this.binanceDataService.removeIdleObservers();
    }

    public getStatus(): { total: number, running: number } {
        const total = this.binanceDataService.getTotalObservers();
        const running = this.binanceDataService.getRunningObservers();
        return { total, running };
    }

    /**
     * Resumes the trades for all accounts that are active
     */
    public resumeTrading(accounts: Array<Account>): void {
        for (const account of accounts) {
            if (account.isActive && account.email !== Emails.SIMULATION &&
                account.activeStrategies.length > 0 && !account.runningState) {
                container.resolve(MountainSeekerV2).setup(account);
            } else {
                log.debug(`Skipped resuming of trading for account ${account.email}`);
            }
        }
    }
}
