import log from "../../logging/log.instance";
import { ConfigService } from "../config-service";
import { singleton } from "tsyringe";
import { DynamodbRepository } from "../../repository/dynamodb-repository";
import { BinanceConnector } from "../../api-connectors/binance-connector";
import { CandlestickInterval } from "../../enums/candlestick-interval.enum";
import { Market } from "../../models/market";
import { StrategyUtils } from "../../utils/strategy-utils";
import { Subject } from "./subject.interface";
import { BaseStrategy } from "../../strategies/base-strategy.interface";
import { GlobalUtils } from "../../utils/global-utils";
import { Currency } from "../../enums/trading-currencies.enum";

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
    private readonly minimumPercentFor24hVariation = -1000;
    private readonly authorizedCurrencies = [Currency.USDT];
    // private readonly authorizedMarkets = ["BTC/USDT", "BTCUP/USDT", "BTCDOWN/USDT", "BNB/USDT", "BNBUP/USDT", "BNBDOWN/USDT",
    //     "ETH/USDT", "ETHUP/USDT", "ETHDOWN/USDT", "ADA/USDT", "ADAUP/USDT", "ADADOWN/USDT", "XRP/USDT", "XRPUP/USDT",
    //     "XRPDOWN/USDT", "SOL/USDT", "LTC/USDT", "LTCUP/USDT", "LTCDOWN/USDT", "DOTCUP/USDT", "DOTDOWN/USDT", "YFIUP/USDT",
    //     "YFIDOWN/USDT", "SHIB/USDT"];

    constructor(private configService: ConfigService,
        private repository: DynamodbRepository,
        private binanceConnector: BinanceConnector) {
        this.getDataFromBinance().then();
    }

    async getMarketsFromBinance(): Promise<void> {
        try {
            // fetch markets with candlesticks
            this.markets = await this.binanceConnector.getMarketsBy24hrVariation(this.minimumPercentFor24hVariation);
            // this.markets = StrategyUtils.filterByAuthorizedMarkets(this.markets, this.authorizedMarkets);
            this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, this.authorizedCurrencies);
            this.binanceConnector.setMarketAdditionalParameters(this.markets);

            await this.fetchAndSetCandleSticks();

            // notify strategies
            this.notifyObservers();

            // sleep
            if (this.allObserversAreRunning() || this.observers.length === 0) {
                await GlobalUtils.sleep(840); // 14 min
            }
            // else {
            //     await GlobalUtils.sleep(15);
            // }

            // to add markets to a DB
            // this.markets.forEach(market => this.repository.putMarket(market));
        } catch (e) {
            log.error(`Error occurred while fetching data from Binance : ${e}`)
        }
    }

    registerObserver(observer: BaseStrategy): void {
        this.observers.push(observer);
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

    notifyObservers(): void {
        this.observers.forEach(observer => observer.update(this.markets));
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
            CandlestickInterval.FIFTEEN_MINUTES,
            CandlestickInterval.THIRTY_MINUTES,
            CandlestickInterval.ONE_HOUR]) {
            StrategyUtils.addCandleSticksWithInterval(this.markets, interval);
            StrategyUtils.setCandlestickPercentVariations(this.markets, interval);
        }
    }

    private allObserversAreRunning(): boolean {
        return this.observers.every(o => o.getState().marketSymbol !== undefined);
    }

}

