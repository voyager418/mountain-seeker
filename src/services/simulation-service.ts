import { StrategyName } from "../models/strategy";
import { Account, Emails } from "../models/account";
import { container, singleton } from "tsyringe";
import { BinanceDataService } from "./observer/binance-data-service";
import { MountainSeekerV2 } from "../strategies/mountain-seeker-v2";


/**
 * This service is responsible to start the simulation strategies.
 */
@singleton()
export class SimulationService {

    constructor(private binanceDataService: BinanceDataService) {}

    public startSimulations(): void {
        const simulationStrategies: Array<StrategyName> = ["strat1-15-15", "strat4-5-5", "strat5-15-30",
            "strat8-5-10", "strat9-30-30", "strat10-5-5", "strat10-5-10", "strat11-30-30", "strat12-30-30",
            "strat13-30-30"];
        for (const strategy of simulationStrategies) {
            const account: Account = {
                email: Emails.SIMULATION,
                maxMoneyAmount: 1000,
                apiKey: process.env.BINANCE_API_KEY!,
                apiSecret: process.env.BINANCE_API_SECRET!,
                isActive: true,
                mailPreferences: {
                    onNewTrade: false,
                    onEndTrade: false
                },
                activeStrategies: [strategy]
            }
            container.resolve(MountainSeekerV2).setup(account);
        }
    }

    public stopTrading(): any {
        return this.binanceDataService.removeIdleObservers();
    }

    public getStatus(): any {
        const total = this.binanceDataService.getTotalObservers();
        const running = this.binanceDataService.getRunningObservers();
        return { total, running };
    }
}
