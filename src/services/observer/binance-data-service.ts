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
    private readonly defaultCandleStickInterval = CandlestickInterval.THIRTY_MINUTES;
    /** Number of candlesticks that will be fetched */
    private readonly defaultNumberOfCandlesticks = 500;
    private readonly minimumNumberOfCandlesticks = 50;
    private readonly minimumPercentFor24hVariation = -1000;
    private readonly authorizedMarkets = ["BTC/USDT", "BTCDOWN/USDT", "BNB/USDT", "BNBDOWN/USDT", "ETH/USDT", "ETHDOWN/USDT",
        "ADA/USDT", "ADADOWN/USDT", "XRP/USDT", "XRPDOWN/USDT", "SOL/USDT", "LTC/USDT", "LTCDOWN/USDT"];

    constructor(private configService: ConfigService,
        private repository: DynamodbRepository,
        private binanceConnector: BinanceConnector) {
        this.getDataFromBinance().then();
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

    notifyObservers(): void {
        this.observers.forEach(observer => observer.update(this.markets));
    }

    async getDataFromBinance(): Promise<void> {
        while (!this.configService.isTestEnvironment()) { // should be "false" when we are running the tests
            await this.getMarketsFromBinance();
        }
    }

    async getMarketsFromBinance(): Promise<void> {
        try {
            // fetch markets with candlesticks
            this.markets = await this.binanceConnector.getMarketsBy24hrVariation(this.minimumPercentFor24hVariation);
            this.binanceConnector.setMarketAmountPrecision(this.markets);
            this.markets = StrategyUtils.filterByAuthorizedMarkets(this.markets, this.authorizedMarkets);

            await this.fetchAndSetCandleSticks();

            // notify strategies
            this.notifyObservers();

            // sleep
            if (this.allObserversAreRunning() || this.observers.length === 0) {
                await GlobalUtils.sleep(1800); // 30 min
            } else {
                await GlobalUtils.sleep(60); // 1 min
            }

            // to add markets to a DB
            // this.markets.forEach(market => this.repository.putMarket(market));
        } catch (e) {
            log.error(`Error occurred while fetching data from Binance : ${e}`)
        }
    }

    private async fetchAndSetCandleSticks() {
        await this.binanceConnector.fetchCandlesticks(this.markets, this.defaultCandleStickInterval, this.defaultNumberOfCandlesticks)
            .catch(e => Promise.reject(e));
        this.markets = StrategyUtils.filterByMinimumAmountOfCandleSticks(this.markets, this.minimumNumberOfCandlesticks,
            CandlestickInterval.THIRTY_MINUTES);
        // 30 min candlesticks are added by default
        StrategyUtils.setCandlestickPercentVariations(this.markets, this.defaultCandleStickInterval);

        for (const interval of [CandlestickInterval.ONE_HOUR,
            CandlestickInterval.FOUR_HOURS,
            CandlestickInterval.SIX_HOURS]) {
            StrategyUtils.addCandleSticksWithInterval(this.markets, interval);
            StrategyUtils.setCandlestickPercentVariations(this.markets, interval);
        }

        this.markets = StrategyUtils.filterByStrangeMarkets(this.markets, this.defaultCandleStickInterval);
    }

    private allObserversAreRunning(): boolean {
        return this.observers.every(o => o.getState().marketSymbol !== undefined);
    }

}

