import { Container, Service } from "typedi";
import * as ccxt from "ccxt";
// eslint-disable-next-line no-duplicate-imports
import { Dictionary, Ticker } from "ccxt";
import log from '../logging/log.instance';
import { Market } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";



/**
 * This service is responsible for communicating with Binance API.
 *
 * It is a wrapper around existing libraries (e.g. ccxt) with
 * possibly additional/custom implementations.
 */
@Service()
export class BinanceConnector {

    /** Binance ccxt instance.
     * Binance API, and others, has rate limits for requests.
     * https://api.binance.com/api/v3/exchangeInfo returns an array describing the limits :
     * [{"rateLimitType":"REQUEST_WEIGHT","interval":"MINUTE","intervalNum":1,"limit":1200},
     * {"rateLimitType":"ORDERS","interval":"SECOND","intervalNum":10,"limit":100},
     * {"rateLimitType":"ORDERS","interval":"DAY","intervalNum":1,"limit":200000}]
     *
     * Usually the requests have a weight of 1 so it means that we can do 1200 requests/minute.
     *
     * @see https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md for more info
     * */
    private binance;

    constructor() {
        this.binance = new ccxt.binance({
            apiKey: Container.get("BINANCE_API_KEY"),
            secret: Container.get("BINANCE_API_SECRET"),
            verbose: false,
            enableRateLimit: false
        });
    }


    /**
     * @param minimumPercent The minimal percent of variation.
     * @returns Markets that have at least `minimumPercent` as their 24hr change variation.
     * Example: when called with '0', returns only the markets that had a positive change.
     */
    public async getMarketsBy24hrVariation(minimumPercent: number): Promise<Array<Market>> {
        const tickers: Dictionary<Ticker> = await this.binance.fetchTickers();
        const res: Array<Market> = [];
        Object.values(tickers)
            .filter(market => market.percentage && market.percentage > minimumPercent)
            .forEach(market => res.push({
                symbol: market.symbol,
                originAsset: Currency[market.symbol.split('/')[1] as keyof typeof Currency],
                targetAsset: market.symbol.split('/')[0],
                candleSticks: [],
                candleSticksPercentageVariations: [] }));
        return res;
    }

    /**
     * @param market The name/symbol of the market. Example: 'BNB/EUR'
     * @param interval Example: '1m', '15m', '1h' ...
     * @param numberOfCandlesticks The number of most recent candlesticks including the current one
     * @returns An array of candlesticks where each element has the following shape [ timestamp, open, high, low, close, volume ]
     */
    public async getCandlesticks(market: string, interval: string, numberOfCandlesticks: number): Promise<any[]> {
        this.binance.enableRateLimit = true;
        const res = await this.binance.fetchOHLCV(
            market,
            interval,
            undefined,
            numberOfCandlesticks
        );
        this.binance.enableRateLimit = true;
        return res;
    }

    /**
     * @param currencies Array of currencies for which the balance will be retrieved
     * @returns A map for each currency and the actual available amount
     */
    async getBalance(currencies: Array<Currency>): Promise<Map<Currency, number>> {
        const balance = await this.binance.fetchBalance(); // TODO maybe refactor to only fetch info for needed currencies
        const res = new Map<Currency, number>();
        for (const currency of currencies) {
            res.set(currency, balance[currency].free);
        }
        return res;
    }

    // For testing
    public test(): void {
        // log.debug(await this.binance.fetchTickers(["PHB/BTC"]));
        // console.log(await this.binance.fetchOHLCV(
        //     'BNB/EUR',
        //     '15m',
        //     undefined,
        //     3
        // ));
        // console.log(this.binance.requiredCredentials);
        // console.log(await this.binance.fetchBalance());
        // console.log(await this.binance.fetchClosedOrders("BNB/EUR"));
    }

    public async getTestMarket(): Promise<Market> {
        const market = await this.binance.fetchTicker("BTC/NGN");
        console.log(market);
        return {
            symbol: market.symbol,
            candleSticks: [],
            candleSticksPercentageVariations: [],
            originAsset: Currency[market.symbol.split('/')[1] as keyof typeof Currency],
            targetAsset: market.symbol.split('/')[0]
        };
    }

    public async getPriceInEur(asset: Currency, amount: number): Promise<number> {
        // TODO
        return 22;
    }


}

