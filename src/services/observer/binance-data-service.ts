import log from "../../logging/log.instance";
import { ConfigService } from "../config-service";
import { singleton } from "tsyringe";
import { DynamodbRepository } from "../../repository/dynamodb-repository";
import { BinanceConnector } from "../../api-connectors/binance-connector";
import { CandlestickInterval } from "../../enums/candlestick-interval.enum";
import { Market } from "../../models/market";
import { StrategyUtils } from "../../utils/strategy-utils";
import { Currency } from "../../enums/trading-currencies.enum";
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
    private readonly minimumPercentFor24hVariation = 1;
    private readonly authorizedCurrencies = [Currency.EUR, Currency.BTC, Currency.BNB, Currency.ETH];
    private readonly minimumTradingVolumeLast24h = 100;

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
        this.observers.forEach(o => o.update(this.markets));
    }

    async getDataFromBinance(): Promise<void> {
        // eslint-disable-next-line no-constant-condition
        while (true) {
            try {
                this.markets = await this.binanceConnector.getMarketsBy24hrVariation(this.minimumPercentFor24hVariation);
                this.binanceConnector.setMarketAmountPrecision(this.markets);
                this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, this.authorizedCurrencies);
                this.markets = StrategyUtils.filterByMinimumTradingVolume(this.markets, this.minimumTradingVolumeLast24h);
                await this.binanceConnector.fetchCandlesticks(this.markets, this.defaultCandleStickInterval, this.defaultNumberOfCandlesticks)
                    .catch(e => Promise.reject(e));
                this.markets = StrategyUtils.filterByMinimumAmountOfCandleSticks(this.markets, this.minimumNumberOfCandlesticks,
                    CandlestickInterval.THIRTY_MINUTES);
                StrategyUtils.setCandlestickPercentVariations(this.markets, this.defaultCandleStickInterval);

                this.notifyObservers();

                if (this.allObserversAreRunning()) {
                    await GlobalUtils.sleep(30);
                }

                // to add markets to a DB
                // this.markets.forEach(market => this.repository.putMarket(market));
            } catch (e) {
                log.error(`Error occurred while fetching data from Binance : ${e}`)
            }
        }
    }

    private allObserversAreRunning(): boolean {
        return this.observers.every(o => o.getState().marketSymbol !== undefined);
    }

}

