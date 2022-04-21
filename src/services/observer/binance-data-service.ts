import log from "../../logging/log.instance";
import { ConfigService } from "../config-service";
import { singleton } from "tsyringe";
import { BinanceConnector } from "../../api-connectors/binance-connector";
import { CandlestickInterval } from "../../enums/candlestick-interval.enum";
import { Market } from "../../models/market";
import { StrategyUtils } from "../../utils/strategy-utils";
import { Subject } from "./subject.interface";
import { BaseStrategy } from "../../strategies/base-strategy.interface";
import { GlobalUtils } from "../../utils/global-utils";
import { Currency } from "../../enums/trading-currencies.enum";
import { Observer } from "./observer.interface";
import ccxt from "ccxt";
import { Emails } from "../../models/account";
const createNamespace = require('continuation-local-storage').createNamespace;
const shortUUID = require('short-uuid');


/**
 * This service continually fetches data from Binance platform.
 * It is an implementation of the Observer pattern
 * {@link https://en.wikipedia.org/wiki/Observer_pattern#UML_class_diagram}
 */
@singleton()
export class BinanceDataService implements Subject {

    private observers: Array<BaseStrategy> = [];
    private markets: Array<Market> = [];

    // Default config for fetching candlesticks from Binance //
    /** This interval is used to construct other intervals (e.g. for 1h, 4h ...) */
    private readonly defaultCandleStickInterval = CandlestickInterval.DEFAULT;
    /** Number of candlesticks that will be fetched */
    private readonly defaultNumberOfCandlesticks = 400;
    private readonly minimumNumberOfCandlesticks = 400;
    private readonly minimumPercentFor24hVariation = this.configService.isSimulation() ? 10 : -3; // so that local testing is faster
    private readonly authorizedCurrencies = [Currency.BUSD];
    private readonly writer = createNamespace('logger');

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
        } catch (e) {
            log.error(`Error occurred while fetching data from Binance : ${e}. Stacktrace: ${JSON.stringify((e as any).stack)}`)
        }
    }


    registerObserver(newObserver: BaseStrategy): void {
        if (this.configService.isSimulation() && this.observers.length < 1) { // if simulation then add only 1 strategy
            this.observers.push(newObserver);
            log.info(`Added ${newObserver.getState().accountEmail} account for trading`);
            return;
        }
        // only 1 strategy can run per account, except if it is a simulation account
        if (!this.configService.isSimulation() &&
            !this.observers.some(o =>
                o.getState().accountEmail === newObserver.getState().accountEmail && o.getState().accountEmail !== Emails.SIMULATION)) {
            this.observers.push(newObserver);
            log.info(`Added ${newObserver.getState().accountEmail} account for trading`);
        }
    }

    removeObserver(observer: BaseStrategy): void {
        const index = this.observers.indexOf(observer, 0);
        if (index > -1) {
            log.info(`Removing observer ${observer.getState().accountEmail}`);
            this.observers.splice(index, 1);
        }
    }

    removeIdleObservers(): { removed: number, running: number } {
        const initialNumberOfObservers = this.observers.length;
        this.observers = this.observers.filter(o => o.getState().marketSymbol !== undefined);
        return {
            removed: initialNumberOfObservers - this.observers.length,
            running: this.observers.length
        }
    }

    /**
     * @return Total number of active strategies
     */
    getTotalObservers(): number {
        return this.observers.length;
    }

    /**
     * @return Number of running strategies
     */
    getRunningObservers(): number {
        return this.observers.filter(o => o.getState().marketSymbol !== undefined).length;
    }

    getBinanceMarketDetails(market: Market): ccxt.Market {
        return this.binanceConnector.getBinanceInstance().markets[market.symbol];
    }

    notifyObservers(observers: Array<Observer>): void {
        let sessionID;
        observers.forEach(observer => {
            this.writer.run(() => {
                sessionID = shortUUID.generate();
                this.writer.set('id', sessionID)
                observer.update(this.markets, sessionID);
            });
        });
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
        // default candlesticks are added implicitly
        StrategyUtils.setCandlestickPercentVariations(this.markets, this.defaultCandleStickInterval);

        for (const interval of [
            CandlestickInterval.FIFTEEN_MINUTES, CandlestickInterval.THIRTY_MINUTES]) {
            StrategyUtils.addCandleSticksWithInterval(this.markets, interval);
            StrategyUtils.setCandlestickPercentVariations(this.markets, interval);
        }
    }

    private allObserversAreRunning(): boolean {
        return this.observers.every(o => o.getState().marketSymbol !== undefined);
    }

}

