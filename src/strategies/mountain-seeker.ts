import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { Container, Service } from "typedi";
import { StrategyDetails, BaseStrategyConfig } from "../models/strategy-details";
import { TradingState } from "../models/trading-state";
import { v4 as uuidv4 } from 'uuid';
import { BinanceService } from "../api-connectors/binance-service";


/**
 * The general goal of this strategy is to select and buy an action
 * that is, and recently was, harshly rising in price.
 * Then sell it when the price starts to decrease.
 */
@Service({ transient: true })
export class MountainSeeker implements BaseStrategy {
    private readonly strategyDetails: StrategyDetails<MountainSeekerConfig>;
    private readonly account: Account;
    private apiConnector: BinanceService; // TODO : this should be dynamic

    private state: TradingState = { // TODO : the state should be initialised
        id: uuidv4(),
        walletBalance: 100,
        profitPercent: 0
    };

    constructor(account: Account,
        strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        this.account = account;
        this.strategyDetails = strategyDetails;
        this.apiConnector = Container.get(BinanceService);
    }

    public async run(): Promise<TradingState> {
        log.info("Trading has started", this.state);

        console.log(await this.apiConnector.getMarkets());

        log.info("Trading has finished", this.state)
        return Promise.resolve(this.state);
    }

    getTradingState(): TradingState {
        return this.state;
    }

}

export type MountainSeekerConfig = BaseStrategyConfig & {
    someCustomConfig?: string
}