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

    public startSimulations(): void {
        const simulationStrategies: Array<StrategyName> = ["strat1-15-15", "strat4-5-5", "strat5-15-30",
            "strat8-5-10", "strat9-30-30", "strat10-5-5", "strat10-5-10"];
        for (const strategy of simulationStrategies) {
            const account: Account = {
                email: Emails.SIMULATION,
                maxMoneyAmount: 1000,
                apiKey: process.env.BINANCE_API_KEY!,
                apiSecret: process.env.BINANCE_API_SECRET!,
                isActive: true,
                mailPreferences: {
                    onNewTrade: false,
                    onEndTrade: strategy === "strat9-30-30"
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
