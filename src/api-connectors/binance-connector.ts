import { Container, Service } from "typedi";
import * as ccxt from "ccxt";
// eslint-disable-next-line no-duplicate-imports
import { Dictionary, Ticker } from "ccxt";
import log from '../logging/log.instance';
import { Market } from "../models/market";
import { Order } from "../models/order";
import { Currency } from "../enums/trading-currencies.enum";
import { OrderType } from "../enums/order-type.enum";
import assert from "assert";
import { OrderAction } from "../enums/order-action.enum";
import { GlobalUtils } from "../utils/global-utils";
import { v4 as uuidv4 } from "uuid";


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
     * @return Balance for a particular `currency`
     */
    public async getBalanceForCurrency(currency: string): Promise<number> {
        const balance = await this.binance.fetchBalance()
            .catch(e => Promise.reject(`Failed to fetch balance for currency ${currency}: ${e}`));
        return balance[currency].free;
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
        // log.debug(`Currently 1 ${ofAsset} ≈ ${lastPrice} ${inAsset}`);
        return Promise.resolve(lastPrice);
    }

    /**
     * Places a new order on the market.
     * @param order Information about the order that will be executed.
     * @param awaitCompletion If `true` then this method will return only when the order is totally filled/completed.
     * @return The updated `order` object
     */
    public async createOrder(order: Order, awaitCompletion: boolean) : Promise<Order> {
        // TODO : there is always a minimum amount allowed to buy depending on a market
        //  see https://github.com/ccxt/ccxt/wiki/Manual#precision-and-limits
        if (BinanceConnector.IS_SIMULATION) {
            log.info(`Executing simulated order %O`, order);
            order.average = 200;
            return Promise.resolve(order);
        }

        log.info(`Executing new order %O`, order);
        let binanceOrder;
        switch (order.type) {
        case OrderType.MARKET:
            binanceOrder = await this.binance.createOrder(order.targetAsset + '/' + order.originAsset,
                "market", order.action, order.amount)
                .catch(e => Promise.reject(`Failed to execute ${JSON.stringify(order, null, 4)} order. ${e}`));
            break;
        case OrderType.STOP_LOSS_LIMIT:
            assert(order.stopPrice !== undefined, "Stop price must be provided for stop-limit orders");
            // TODO : "it would be safer for you to set the stop price (trigger price) a bit higher than the limit
            //  price (for sell orders) or a bit lower than the limit price (for buy orders). This increases the
            //  chances of your limit order getting filled after the stop-limit is triggered."
            //   @see https://academy.binance.com/en/articles/what-is-a-stop-limit-order
            binanceOrder = await this.binance.createOrder(order.targetAsset + '/' + order.originAsset,
                "STOP_LOSS_LIMIT", order.action, order.amount, order.limitPrice, {
                    stopPrice: order.stopPrice
                })
                .catch(e => Promise.reject(`Failed to execute ${JSON.stringify(order, null, 4)} order. ${e}`));
            break;
        default:
            return Promise.reject(`Order type not recognized : ${order.type}`);
        }

        order.externalId = binanceOrder.id;
        order.status = binanceOrder.status;
        order.datetime = binanceOrder.datetime;
        order.info = binanceOrder.info;
        order.filled = binanceOrder.filled;
        order.remaining = binanceOrder.remaining;
        order.average = binanceOrder.average;
        if (!awaitCompletion) {
            log.debug(`Created binance order : ${JSON.stringify(order, null, 4)}`);
            return Promise.resolve(order);
        }

        const completedOrder = await this.waitForOrderCompletion(order, 3).catch(e => Promise.reject(e));
        if (!completedOrder) {
            return Promise.reject("BUY order took to much time to execute");
        }
        log.debug(`Created binance order : ${JSON.stringify(completedOrder, null, 4)}`);
        return Promise.resolve(completedOrder);
    }

    /**
     * Resolves only when the order's status changes to `closed`
     * @return {@link Order} if order has been closed and `undefined` if still not after x `retries`
     */
    public async waitForOrderCompletion(order: Order, retries: number): Promise<Order | undefined> {
        if (BinanceConnector.IS_SIMULATION) {
            return Promise.resolve(undefined);
        }
        let filled = false;
        let remainingRetries = retries;
        while (!filled && remainingRetries > 0) {
            await GlobalUtils.sleep(2);
            order = await this.getOrder(order.externalId!,
                `${order.targetAsset}/${order.originAsset}`, order.id)
                .catch(e => Promise.reject(e));
            filled = order.status === "closed";
            if (filled) {
                return Promise.resolve(order);
            }
            if (remainingRetries === 0) {
                return Promise.resolve(undefined);
            }
            remainingRetries--;
        }
        return Promise.resolve(undefined);
    }

    /**
     * @return Order information
     */
    public async getOrder(orderId: string, marketSymbol: string, internalOrderId: string) : Promise<Order> {
        const binanceOrder = await this.binance.fetchOrder(orderId, marketSymbol)
            .catch(e => Promise.reject(e));
        const order: Order = {
            externalId: binanceOrder.id,
            id: internalOrderId,
            action: binanceOrder.side as OrderAction,
            amount: binanceOrder.amount,
            filled: binanceOrder.filled,
            remaining: binanceOrder.remaining,
            average: binanceOrder.average,
            status: binanceOrder.status,
            datetime: binanceOrder.datetime,
            info: binanceOrder.info,
            originAsset: Currency[binanceOrder.symbol.split('/')[1] as keyof typeof Currency],
            targetAsset: binanceOrder.symbol.split('/')[0]
        };
        log.debug(`Fetched information about order : ${JSON.stringify(order, null, 4)}`);
        return Promise.resolve(order);
    }

    /**
     * @return The cancelled order
     */
    public async cancelOrder(orderId: string, marketSymbol: string, internalOrderId: string) : Promise<Order> {
        if (BinanceConnector.IS_SIMULATION) {
            const o = {
                id: uuidv4(),
                action: OrderAction.SELL,
                amount: 2,
                average: 200,
                originAsset: Currency.EUR,
                targetAsset: "BNB",
                type: OrderType.STOP_LOSS_LIMIT
            }
            log.info(`Executing simulated cancel order %O`, o);
            return Promise.resolve(o);
        }
        const binanceOrder = await this.binance.cancelOrder(orderId, marketSymbol)
            .catch(e => Promise.reject(e));
        const order: Order = {
            externalId: binanceOrder.id,
            id: internalOrderId,
            action: binanceOrder.side as OrderAction,
            amount: binanceOrder.amount,
            filled: binanceOrder.filled,
            remaining: binanceOrder.remaining,
            average: binanceOrder.average,
            status: binanceOrder.status,
            datetime: binanceOrder.datetime,
            info: binanceOrder.info,
            originAsset: Currency[binanceOrder.symbol.split('/')[1] as keyof typeof Currency],
            targetAsset: binanceOrder.symbol.split('/')[0]
        };
        log.debug(`Cancelled order : ${JSON.stringify(order, null, 4)}`);
        return Promise.resolve(order);
    }

}

