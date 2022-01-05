import log from "../../logging/log.instance";
import { ConfigService } from "../config-service";
import { singleton } from "tsyringe";
// import { DynamodbRepository } from "../../repository/dynamodb-repository";
import { BinanceConnector } from "../../api-connectors/binance-connector";
import { CandlestickInterval } from "../../enums/candlestick-interval.enum";
import { Market } from "../../models/market";
import { StrategyUtils } from "../../utils/strategy-utils";
import { Subject } from "./subject.interface";
import { BaseStrategy } from "../../strategies/base-strategy.interface";
import { GlobalUtils } from "../../utils/global-utils";
import { Currency } from "../../enums/trading-currencies.enum";
import { Observer } from "./observer.interface";

/**
 * This service continually fetches data from Binance platform.
 * It is an implementation of the Observer pattern
 * {@link https://en.wikipedia.org/wiki/Observer_pattern#UML_class_diagram}
 */
@singleton()
export class BinanceDataService implements Subject {

    private readonly observers: Array<BaseStrategy> = [];
    private markets: Array<Market> = [];

    // Default config for fetching candlesticks from Binance //
    /** This interval is used to construct other intervals (e.g. for 1h, 4h ...) */
    private readonly defaultCandleStickInterval = CandlestickInterval.DEFAULT;
    /** Number of candlesticks that will be fetched */
    private readonly defaultNumberOfCandlesticks = 400;
    private readonly minimumNumberOfCandlesticks = 400;
    private readonly minimumPercentFor24hVariation = this.configService.isSimulation() ? 10 : -3; // so that local testing is faster
    private readonly authorizedCurrencies = [Currency.BUSD];

    constructor(private configService: ConfigService,
        private binanceConnector: BinanceConnector) {
        this.getDataFromBinance().then();
    }

    async getMarketsFromBinance(): Promise<void> {
        try {
            // fetch markets with candlesticks
            this.markets = await this.binanceConnector.getMarketsBy24hrVariation(this.minimumPercentFor24hVariation);
            this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, this.authorizedCurrencies);
            this.markets = StrategyUtils.filterByMinimumTradingVolume(this.markets, 400000);
            this.binanceConnector.setMarketAdditionalParameters(this.markets);

            await this.fetchAndSetCandleSticks();

            // notify strategies
            this.notifyObservers(this.observers);

            // sleep
            if (this.allObserversAreRunning() || this.observers.length === 0) {
                await GlobalUtils.sleep(840); // 14 min
            }

            // to add markets to a DB
            // this.markets.forEach(market => this.repository.putMarket(market));
        } catch (e) {
            log.error(`Error occurred while fetching data from Binance : ${e}`)
        }
    }

    registerObserver(observer: BaseStrategy): void {
        // TODO remove if
        if (this.observers.length < 4) {
            this.observers.push(observer);
        }
    }

    removeObserver(observer: BaseStrategy): void {
        const index = this.observers.indexOf(observer, 0);
        if (index > -1) {
            this.observers.splice(index, 1);
        }
    }

    removeAllObservers(): { removed: number, running: number } {
        const running = this.observers.filter(o => o.getState().marketSymbol !== undefined).length;
        const removed = this.observers.length;
        this.observers.splice(0);
        return {
            removed,
            running
        }
    }

    getObserversStatus(): { total: number, running: number } {
        const running = this.observers.filter(o => o.getState().marketSymbol !== undefined).length;
        const total = this.observers.length;
        return {
            total,
            running
        }
    }

    notifyObservers(observers: Array<Observer>): void {
        observers.forEach(observer => observer.update(this.markets));
    }

    async getDataFromBinance(): Promise<void> {
        while (!this.configService.isTestEnvironment()) { // should be "false" when we are running the tests
            await this.getMarketsFromBinance();
        }
    }

    private async fetchAndSetCandleSticks() {
        await this.binanceConnector.fetchCandlesticks(this.markets, this.defaultCandleStickInterval, this.defaultNumberOfCandlesticks)
            .catch(e => Promise.reject(e));
        this.markets = StrategyUtils.filterByMinimumAmountOfCandleSticks(this.markets, this.minimumNumberOfCandlesticks,
            CandlestickInterval.DEFAULT);
        // default candlesticks are added by default
        StrategyUtils.setCandlestickPercentVariations(this.markets, this.defaultCandleStickInterval);

        for (const interval of [
            CandlestickInterval.FIFTEEN_MINUTES]) {
            StrategyUtils.addCandleSticksWithInterval(this.markets, interval);
            StrategyUtils.setCandlestickPercentVariations(this.markets, interval);
        }
    }

    private allObserversAreRunning(): boolean {
        return this.observers.every(o => o.getState().marketSymbol !== undefined);
    }

}

