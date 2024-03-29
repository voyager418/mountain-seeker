import { StrategyName } from "../models/strategy";
import { Account } from "../models/account";
import { container, singleton } from "tsyringe";
import { BinanceDataService } from "./observer/binance-data-service";
import { MountainSeekerV2 } from "../strategies/mountain-seeker-v2";
import { Email } from "../enums/email.enum";


/**
 * This service is responsible to start the simulation strategies.
 */
@singleton()
export class SimulationService {
    private simulationStrategies: Array<StrategyName> = ["strat4-5-5",
        "strat8-5-10", "strat10-5-5", "strat10-5-10", "strat15-5-5",
        "strat15-5-10", "strat16-30-30", "strat17-15-15",
        "strat18-5-5", "strat19-5-10", "strat20-15-30"];

    constructor(private binanceDataService: BinanceDataService) {}

    public startSimulations(): void {
        for (const strategy of this.simulationStrategies) {
            const account: Account = {
                email: Email.SIMULATION,
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
