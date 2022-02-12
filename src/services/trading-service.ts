import { container, singleton } from "tsyringe";
import { BinanceDataService } from "./observer/binance-data-service";


/**
 * This service is responsible to start the appropriate trading strategy.
 */
@singleton()
export class TradingService {

    public stopTrading(): any {
        return container.resolve(BinanceDataService).removeIdleObservers();
    }

    public getStatus(): any {
        const total = container.resolve(BinanceDataService).getTotalObservers();
        const running = container.resolve(BinanceDataService).getRunningObservers();
        return { total, running };
    }
}
