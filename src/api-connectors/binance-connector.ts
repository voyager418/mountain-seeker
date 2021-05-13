import { Container, Service } from "typedi";
import * as ccxt from "ccxt";
// eslint-disable-next-line no-duplicate-imports
import { Dictionary, Ticker } from "ccxt";
import log from '../logging/log.instance';
import { Market, OHLCV } from "../models/market";
import { Order } from "../models/order";
import { Currency } from "../enums/trading-currencies.enum";
import { OrderType } from "../enums/order-type.enum";
import { GlobalUtils } from "../utils/global-utils";
import { v4 as uuidv4 } from "uuid";
import { SimulationUtils } from "../utils/simulation-utils";

const CONFIG = require('config');

/**
 * A binance buy/sell market order contains a list of fills.
 * This allows to know the exact asset amount that was used when commission is deduced.
 * Example of a fill object for a sell order on BTC/EUR market :
 * {
 *   "price": "47212.49000000",
 *   "qty": "0.00044600",
 *   "commission": "0.02105677",
 *   "commissionAsset": "EUR",
 *   "tradeId": 43143323
 *   }
 */
interface MarketOrderFill {
    price: string,
    qty: string,
    commission: string,
    commissionAsset: string
}

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
     * @return Markets that have at least `minimumPercent` as their 24hr change variation.
     * Example: when called with '0', returns only the markets that had a positive change.
     */
    public async getMarketsBy24hrVariation(minimumPercent: number): Promise<Array<Market>> {
        let tickers;
        let retires = 3;
        while (!tickers && retires-- > -1) {
            try {
                tickers = await this.binance.fetchTickers();
            } catch (e) {
                if (retires > -1) {
                    log.warn("Failed to fetch 24h tickers. Retrying...");
                    await GlobalUtils.sleep(30);
                } else {
                    return Promise.reject(`Failed to fetch tickers. ${e}`);
                }
            }
        }

        const res: Array<Market> = [];
        Object.values(tickers as Dictionary<Ticker>)
            .filter(market => market.percentage && market.percentage > minimumPercent)
            .forEach(market => res.push({
                symbol: market.symbol,
                originAsset: Currency[market.symbol.split('/')[1] as keyof typeof Currency],
                targetAsset: market.symbol.split('/')[0],
                percentChangeLast24h: market.percentage,
                originAssetVolumeLast24h: market.quoteVolume,
                targetAssetVolumeLast24h: market.baseVolume,
                targetAssetPrice: market.ask, // current best ask (sell) price
                candleSticks: [],
                candleSticksPercentageVariations: [] }));
        return res;
    }

    /**
     * @param market The name/symbol of the market. Example: 'BNB/EUR'
     * @param interval Example: '1m', '15m', '1h' ...
     * @param numberOfCandlesticks The number of most recent candlesticks including the current one
     * @param retries Number of times that the operation will be repeated after failure
     * @return An array of candlesticks where each element has the following shape [ timestamp, open, high, low, close, volume ]
     */
    public async getCandlesticks(market: string, interval: string, numberOfCandlesticks: number, retries: number): Promise<OHLCV[]> {
        let candleSticks;
        while (!candleSticks && retries-- > -1) {
            try {
                candleSticks = await this.binance.fetchOHLCV(
                    market,
                    interval,
                    undefined,
                    numberOfCandlesticks
                );
                return candleSticks;
            } catch (e) {
                if (retries <= -1) {
                    return Promise.reject(`Failed to fetch candle sticks.`);
                } else {
                    if (e.message.toString().includes("DDoSProtection")) {
                        return Promise.reject(`Failed to fetch candle sticks: ${e}`);
                    }
                    log.warn(`Failed to fetch candle sticks: ${e}. Retrying...`);
                    await GlobalUtils.sleep(2);
                }
            }
        }
        return Promise.reject(`Failed to fetch candle sticks.`);
    }

    /**
     * @param currencies Array of currencies for which the balance will be retrieved
     * @return A map for each currency and the actual available amount
     */
    public async getBalance(currencies: Array<Currency>): Promise<Map<Currency, number>> {
        // TODO maybe add retries or increase the sleep interval
        await GlobalUtils.sleep(2); // it seems like the wallet balance is not updating instantly sometimes
        const balance = await this.binance.fetchBalance()
            .catch(e => Promise.reject(`Failed to fetch wallet balance : ${e}`));
        const res = new Map<Currency, number>();
        for (const currency of currencies) {
            res.set(currency, balance[currency].free);
        }
        return res;
    }

    /**
     * @return Available balance for asset
     */
    public async getBalanceForAsset(asset: string): Promise<number> {
        // TODO instead of wasting some time this can also be calculated by
        //   making the sum of quantity - comission in the 'fills' array in the order object
        await GlobalUtils.sleep(2); // it seems like the wallet balance is not updating instantly sometimes
        const balance = await this.binance.fetchBalance()
            .catch(e => Promise.reject(`Failed to fetch wallet balance : ${e}`));
        return balance[asset].free;
    }

    /**
     * @return Balance for a particular `currency`
     */
    public async getBalanceForCurrency(currency: string): Promise<number> {
        // TODO maybe add retries or increase the sleep interval
        await GlobalUtils.sleep(2);
        const balance = await this.binance.fetchBalance()
            .catch(e => Promise.reject(`Failed to fetch balance for currency ${currency}: ${e}`));
        return balance[currency].free;
    }

    /**
     * This method always returns a valid result or exits with an error.
     * @return A number that stands for the amount of `inAsset` needed to buy 1 unit of `ofAsset`
     */
    public async getUnitPrice(inAsset: Currency, ofAsset: string, verbose?: boolean): Promise<number> {
        const marketSymbol = ofAsset.toString() + '/' + inAsset.toString();
        let lastPrice: number | undefined = undefined;
        await this.binance.fetchTicker(marketSymbol)
            .then(market => lastPrice = market.last)
            .catch(error => `Failed to get information for ${marketSymbol} market. ${error}`);
        if (lastPrice === undefined) {
            return Promise.reject(`Last price of ${marketSymbol} was not found`);
        }
        if (verbose) {
            log.debug(`Currently 1 ${ofAsset} ≈ ${lastPrice} ${inAsset}`);
        }
        return Promise.resolve(lastPrice);
    }

    /**
     * Creates a market order.
     * There is always a minimum amount allowed to buy depending on a market, see {@link https://github.com/ccxt/ccxt/wiki/Manual#precision-and-limits}
     *
     * @param awaitCompletion If `true` then there will be a delay in order to wait for the order status to
     * change from `open` to `closed`
     * @param retries Indicates the number of times the order will be repeated after a failure
     * @param amountToInvest The number of origin asset that is going to be invested (needed for retries).
     */
    public async createMarketOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell", amount: number,
        awaitCompletion?: boolean, retries?: number, amountToInvest?: number): Promise<Order> {
        if (CONFIG.simulation) {
            const order: Order = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, side);
            log.info(`Executing simulated order %O`, order);
            return Promise.resolve(order);
        }

        log.debug("Creating new market order on %O/%O", targetAsset, originAsset);
        let binanceOrder;
        try {
            binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                "market", side, amount);
        } catch (e) {
            log.error(`Failed to execute ${side} market order of ${amount} on market ${targetAsset}/${originAsset}. ${e}`);
        }
        if (!binanceOrder && retries && amountToInvest) {
            let amountToBuy;
            while (retries-- > -1) {
                try {
                    const unitPrice = await this.getUnitPrice(originAsset, targetAsset, true);
                    amountToBuy = amountToInvest/unitPrice;
                    binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                        "market", side, amountToBuy);
                } catch (e) {
                    if (retries > -1) {
                        log.warn(`Failed to execute ${side} market order of ${amountToBuy} on market ${targetAsset}/${originAsset}. Retrying...`);
                        await GlobalUtils.sleep(1);
                    }
                }
            }
        }
        if (!binanceOrder) {
            return Promise.reject(`Failed to execute ${side} market order on market ${targetAsset}/${originAsset}`);
        }

        const order: Order = {
            id: uuidv4(),
            externalId: binanceOrder.id,
            amountOfTargetAsset: amount,
            filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled, OrderType.MARKET, side),
            remaining: binanceOrder.remaining,
            average: binanceOrder.average,
            amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, OrderType.MARKET, side),
            status: binanceOrder.status,
            originAsset,
            targetAsset,
            side,
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            type: OrderType.MARKET,
            info: binanceOrder.info
        }
        if (!awaitCompletion) {
            log.debug(`Created binance order : ${JSON.stringify(order, null, 4)}`);
            return Promise.resolve(order);
        }

        const orderCompletionRetries = 3;
        const completedOrder = await this.waitForOrderCompletion(order, originAsset, targetAsset, orderCompletionRetries)
            .catch(e => Promise.reject(e));
        if (!completedOrder) {
            return Promise.reject(`Order ${order.id} still not closed after ${orderCompletionRetries} retries`);
        }
        log.debug(`Created ${order.type} order : ${JSON.stringify(completedOrder, null, 4)}`);
        return Promise.resolve(completedOrder);
    }

    /**
     * Creates a stop limit order.
     * @param retries Indicates the number of times the order will be repeated in case of a failure
     */
    public async createStopLimitOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell", amount: number,
        stopPrice: number, limitPrice: number, retries?: number): Promise<Order> {
        if (CONFIG.simulation) {
            const simulatedOrder: Order = SimulationUtils.getSimulatedStopLimitOrder(originAsset, targetAsset, side);
            log.info(`Executing simulated order %O`, simulatedOrder);
            return Promise.resolve(simulatedOrder);
        }

        log.debug("Creating %O stop limit order on %O/%O of %O%O. With stopPrice : %O, limitPrice: %O",
            side, targetAsset, originAsset, amount, targetAsset, stopPrice, limitPrice);
        let binanceOrder;
        try {
            binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                "STOP_LOSS_LIMIT", side, amount, limitPrice, {
                    stopPrice: stopPrice
                });
        } catch (e) {
            log.error(`Failed to execute stop limit order of ${amount} on ${targetAsset}/${originAsset}. ${e}`);
        }
        if (!binanceOrder && retries) {
            while (retries > 0) {
                try {
                    binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                        "STOP_LOSS_LIMIT", side, amount, limitPrice, {
                            stopPrice: stopPrice
                        });
                } catch (e) {
                    log.error("Failed to create order : ", e);
                    retries--;
                    if (retries > 0) {
                        log.debug("Retrying ...");
                    }
                }
            }
        }

        if (!binanceOrder) {
            return Promise.reject(`Failed to execute ${side} stop limit order of ${amount} on market ${targetAsset}/${originAsset}`);
        }

        const order:Order = {
            id: uuidv4(),
            externalId: binanceOrder.id,
            amountOfTargetAsset: amount,
            stopPrice,
            limitPrice,
            filled: binanceOrder.filled,
            remaining: binanceOrder.remaining,
            average: binanceOrder.average,
            amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, OrderType.STOP_LIMIT, side),
            status: binanceOrder.status,
            originAsset,
            targetAsset,
            side,
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            type: OrderType.STOP_LIMIT,
            info: binanceOrder.info
        }

        log.debug(`Created ${order.type} order : ${JSON.stringify(order, null, 4)}`);
        return Promise.resolve(order);
    }

    /**
     * Resolves only when the order's status changes to `closed` and number of `retries` reaches 0
     * @return {@link Order} if order has been closed and `undefined` if still not after x `retries`
     */
    public async waitForOrderCompletion(order: Order, originAsset: Currency, targetAsset: string, retries: number): Promise<Order | undefined> {
        if (CONFIG.simulation) {
            return Promise.resolve(undefined);
        }
        let filled = order.status === "closed";
        if (filled) {
            log.debug("Skipping order completion waiting as it is already complete");
            return Promise.resolve(order);
        }
        let remainingRetries = retries;
        while (!filled && remainingRetries > 0) {
            log.debug("Waiting for order completion");
            try {
                order = await this.getOrder(order.externalId, originAsset, targetAsset, order.id, order.type!, undefined, true);
                log.debug("Order %O with status %O was found", order.externalId, order.status);
                filled = order.status === "closed";
                if (filled) {
                    return Promise.resolve(order);
                }
            } catch (e) {
                log.warn(`Order with binance id ${order.externalId} was not found : `, e);
            }

            if (remainingRetries === 0) {
                return Promise.resolve(undefined);
            }
            remainingRetries--;
            await GlobalUtils.sleep(2);
        }
        return Promise.resolve(undefined);
    }

    /**
     * @return Order information
     * @param retries The number of times that the request is retried in case of failure
     * @param verbose If `true` then more information is printed to console
     */
    public async getOrder(externalId: string, originAsset: Currency, targetAsset: string,
        internalOrderId: string, orderType: OrderType, retries?: number, verbose?: boolean) : Promise<Order> {
        if (verbose) {
            log.debug(`Getting information about binance order ${externalId}`);
        }
        if (CONFIG.simulation) {
            const order: Order = SimulationUtils.getSimulatedGetOrder(originAsset, targetAsset);
            log.info(`Executing simulated order %O`, order);
            return Promise.resolve(order);
        }
        let binanceOrder;
        while (!binanceOrder || (retries && retries > -1)) {
            try {
                binanceOrder = await this.binance.fetchOrder(externalId, `${targetAsset}/${originAsset}`);
                const order: Order = {
                    type: orderType,
                    id: internalOrderId,
                    externalId: binanceOrder.id,
                    side: binanceOrder.side,
                    amountOfTargetAsset: binanceOrder.amount,
                    filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled, orderType, binanceOrder.side),
                    remaining: binanceOrder.remaining,
                    average: binanceOrder.average,
                    amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, orderType, binanceOrder.side),
                    status: binanceOrder.status,
                    datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
                    info: binanceOrder.info,
                    originAsset,
                    targetAsset
                };
                if (verbose) {
                    log.debug(`Fetched information about order : ${JSON.stringify(order, null, 4)}`);
                }
                return Promise.resolve(order);
            } catch (e) {
                log.warn(`Error while getting order ${externalId}`, e);
                if (retries) {
                    if (retries === -1) {
                        return Promise.reject(e);
                    } else {
                        retries--;
                        log.debug("Retrying to get order %O", externalId);
                        await GlobalUtils.sleep(2);
                    }
                } else {
                    return Promise.reject(e);
                }
            }
        }
        return Promise.reject(`Order ${externalId} was not found`);
    }

    /**
     * @return The cancelled order
     */
    public async cancelOrder(orderId: string, internalOrderId: string, originAsset: Currency, targetAsset: string) : Promise<Order> {
        if (CONFIG.simulation) {
            const o = {
                id: uuidv4(),
                externalId: "",
                filled: 0,
                remaining: 0,
                status: "closed" as "open" | "closed" | "canceled",
                datetime: "",
                side: "sell" as "buy" | "sell",
                amountOfTargetAsset: 2,
                average: 200,
                originAsset: Currency.EUR,
                targetAsset: "BNB",
                type: OrderType.STOP_LIMIT
            }
            log.info(`Executing simulated cancel order %O`, o);
            return Promise.resolve(o);
        }
        const binanceOrder = await this.binance.cancelOrder(orderId, `${targetAsset}/${originAsset}`)
            .catch(e => Promise.reject(e));
        const order: Order = {
            externalId: binanceOrder.id,
            id: internalOrderId,
            side: binanceOrder.side,
            amountOfTargetAsset: binanceOrder.amount,
            filled: binanceOrder.filled,
            remaining: binanceOrder.remaining,
            average: binanceOrder.average,
            status: binanceOrder.status,
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            info: binanceOrder.info,
            originAsset,
            targetAsset
        };
        log.debug(`Cancelled order : ${JSON.stringify(order, null, 4)}`);
        return Promise.resolve(order);
    }

    /**
     * Sets the {@link Market.minNotional} field
     */
    public setMarketMinNotional(market: Market): void {
        const minNotionalFilter = this.binance.markets[market.symbol].info.filters.filter((f: { filterType: string; }) => f.filterType === "MIN_NOTIONAL")[0];
        if (minNotionalFilter) {
            market.minNotional = Number(minNotionalFilter.minNotional);
            log.debug("Market's minNotional is %O", market.minNotional);
        }
    }

    /**
     * Sets the {@link Market.amountPrecision} field
     */
    public setMarketAmountPrecision(markets: Array<Market>): void {
        // fori and not a forof loop is needed because the array's content is modified in the loop
        for (let i = 0; i < markets.length; i++) {
            const amountPrecision = this.binance.markets[markets[i].symbol]?.precision?.amount;
            if (amountPrecision && amountPrecision >= 0) {
                markets[i].amountPrecision = amountPrecision;
            }
        }
    }

    /**
     * Used for debug purposes
     */
    public printMarketDetails(symbol: string): void {
        log.debug(`Market details : ${JSON.stringify(this.binance.markets[symbol], null, 4)}`);
    }

    private static getBelgiumDateTime(date: string): string {
        try {
            const res = new Date(date);
            res.setHours(res.getHours() + 2);
            return res.toISOString();
        } catch (e) {
            // no date found
            return date;
        }
    }

    /**
     * @return 0 if the order is incomplete or the amount of origin asset that was used when commission is deduced (for MARKET orders)
     */
    private static computeAmountOfOriginAsset(binanceOrder: ccxt.Order, remaining: number, orderType: OrderType, side: "buy" | "sell"): number {
        // if the order is incomplete
        if (remaining > 0) {
            return 0;
        }

        if (orderType !== OrderType.MARKET) {
            return binanceOrder.average! * (binanceOrder.filled + binanceOrder.remaining);
        }

        const fills: [MarketOrderFill] | undefined = binanceOrder.info?.fills;
        if (!fills) {
            return binanceOrder.average! * (binanceOrder.filled + binanceOrder.remaining);
        }
        let amountOfOriginAsset = 0;
        for (const fill of fills) {
            if (side === "buy") {
                amountOfOriginAsset += Number(fill.price) * Number(fill.qty);
            } else {
                amountOfOriginAsset += Number(fill.price) * Number(fill.qty) - Number(fill.commission);
            }
        }
        return amountOfOriginAsset;
    }

    /**
     * @return amount of target asset that was purchased when commission is deduced (for MARKET orders)
     */
    private static computeAmountOfFilledAsset(binanceOrder: ccxt.Order, filled: number, orderType: OrderType, side: "buy" | "sell"): number {
        if (orderType !== OrderType.MARKET) {
            return filled;
        }

        const fills: [MarketOrderFill] | undefined = binanceOrder.info?.fills;
        if (!fills) {
            return filled;
        }
        let amountOfOriginAsset = 0;
        for (const fill of fills) {
            if (side === "sell") {
                amountOfOriginAsset += Number(fill.qty);
            } else {
                amountOfOriginAsset += Number(fill.qty) - Number(fill.commission);
            }
        }
        return amountOfOriginAsset;
    }

}

