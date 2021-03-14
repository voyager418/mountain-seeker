import { Container, Service } from "typedi";
import * as ccxt from "ccxt";
// eslint-disable-next-line no-duplicate-imports
import { Dictionary, Ticker } from "ccxt";
import log from '../logging/log.instance';
import { Market } from "../models/market";
import { Order } from "../models/order";
import { Currency } from "../enums/trading-currencies.enum";


/**
 * This service is responsible for communicating with Binance API.
 *
 * It is a wrapper around existing libraries (e.g. ccxt) with
 * possibly additional/custom implementations.
 */
@Service()
export class BinanceConnector { // TODO: this should implement an interface

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

    private static IS_SIMULATION: boolean;

    constructor() {
        BinanceConnector.IS_SIMULATION = Container.get("IS_SIMULATION");
        this.binance = new ccxt.binance({
            apiKey: Container.get("BINANCE_API_KEY"),
            secret: Container.get("BINANCE_API_SECRET"),
            verbose: false,
            enableRateLimit: false
        });
    }


    /**
     * @param minimumPercent The minimal percent of variation.
     * @return Markets that have at least `minimumPercent` as their 24hr change variation.
     * Example: when called with '0', returns only the markets that had a positive change.
     */
    public async getMarketsBy24hrVariation(minimumPercent: number): Promise<Array<Market>> {
        const tickers: Dictionary<Ticker> = await this.binance.fetchTickers()
            .catch(e => Promise.reject(`Failed to fetch tickers. ${e}`));
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
     * @return An array of candlesticks where each element has the following shape [ timestamp, open, high, low, close, volume ]
     */
    public async getCandlesticks(market: string, interval: string, numberOfCandlesticks: number): Promise<any[]> {
        // this.binance.enableRateLimit = true;
        return await this.binance.fetchOHLCV(
            market,
            interval,
            undefined,
            numberOfCandlesticks
        ).catch(e => Promise.reject(`Failed to fetch candle sticks. ${e}`));
    }

    /**
     * @param currencies Array of currencies for which the balance will be retrieved
     * @return A map for each currency and the actual available amount
     */
    public async getBalance(currencies: Array<Currency>): Promise<Map<Currency, number>> {
        // TODO maybe refactor to only fetch info for needed currencies
        const balance = await this.binance.fetchBalance()
            .catch(e => Promise.reject(`Failed to fetch wallet balance : ${e}`));
        const res = new Map<Currency, number>();
        for (const currency of currencies) {
            res.set(currency, balance[currency].free);
        }
        return res;
    }

    /**
     * This method always returns a valid result or exits with an error.
     * @return A number that stands for the amount of `inAsset` needed to buy 1 unit of `ofAsset`
     */
    public async getUnitPrice(inAsset: Currency, ofAsset: string): Promise<number> {
        const marketSymbol = ofAsset.toString() + '/' + inAsset.toString();
        let lastPrice: number | undefined = undefined;
        await this.binance.fetchTicker(marketSymbol)
            .then(market => lastPrice = market.last)
            .catch(error => `Failed to get information for ${marketSymbol} market. ${error}`);
        if (lastPrice === undefined) {
            return Promise.reject(`Last price of ${marketSymbol} was not found`);
        }
        log.info(`Currently 1 ${ofAsset} ≈ ${lastPrice} ${inAsset}`);
        return Promise.resolve(lastPrice);
    }

    /**
     * Places a new order on the market.
     * @param order Information about the order that will be executed.
     * @return The updated `order` object
     */
    public async createOrder(order: Order) : Promise<Order> {
        // TODO : there is always a minimum amount allowed to buy depending on a market
        //  see https://github.com/ccxt/ccxt/wiki/Manual#precision-and-limits
        if (BinanceConnector.IS_SIMULATION) {
            log.info(`Executing simulated order %O`, order);
            return Promise.resolve(order);
        }

        log.info(`Executing new order %O`, order);
        const binanceOrder = await this.binance.createOrder(order.targetAsset + '/' + order.originAsset,
            order.type, order.action, order.amount)
            .catch(e => Promise.reject(`Failed to execute ${JSON.stringify(order)} order. ${e}`));
        log.debug(`Created binance order : ${binanceOrder}`);
        order.externalId = binanceOrder.id;
        order.status = binanceOrder.status;
        order.datetime = binanceOrder.datetime;
        order.info = binanceOrder.info;
        return Promise.resolve(order);
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
        // const market = await this.binance.fetchTicker("BNB/BTC");
        const market = await this.binance.fetchTicker("CHZ/BNB");
        // const market = await this.binance.fetchTicker("BNB/EUR");
        // console.log(market);
        return {
            symbol: market.symbol,
            originAsset: Currency[market.symbol.split('/')[1] as keyof typeof Currency],
            targetAsset: market.symbol.split('/')[0],
            candleSticks: [],
            candleSticksPercentageVariations: []
        };
    }

}

