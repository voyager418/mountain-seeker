import ccxt from "ccxt";
import log from '../logging/log.instance';
import { Market, TOHLCV } from "../models/market";
import { Order } from "../models/order";
import { Currency } from "../enums/trading-currencies.enum";
import { OrderType } from "../enums/order-type.enum";
import { GlobalUtils } from "../utils/global-utils";
import { v4 as uuidv4 } from "uuid";
import { SimulationUtils } from "../utils/simulation-utils";
import hmacSHA256 from 'crypto-js/hmac-sha256';
import cliProgress from "cli-progress";
import { ConfigService } from "../services/config-service";
import { singleton } from "tsyringe";

const axios = require('axios').default;


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
@singleton()
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
    private readonly binance;

    private readonly V1_URL_BASE_PATH = "https://api.binance.com/sapi/v1";

    constructor(private configService: ConfigService) {
        this.binance = new ccxt.binance({
            apiKey: process.env.BINANCE_API_KEY,
            secret: process.env.BINANCE_API_SECRET,
            verbose: false,
            enableRateLimit: false
        });
    }

    getBinanceInstance(): ccxt.binance {
        return this.binance;
    }

    /**
     * @param minimumPercent The minimal percent of variation.
     * @return Markets that have at least `minimumPercent` as their 24h change variation.
     * Example: when called with '0', returns only the markets that had a positive or 0 change.
     */
    public async getMarketsBy24hrVariation(minimumPercent: number): Promise<Array<Market>> {
        let tickers;
        let retries = 3;
        while (!tickers && retries-- > -1) {
            try {
                tickers = await this.binance.fetchTickers();
            } catch (e) {
                if (retries > -1) {
                    log.warn("Failed to fetch 24h tickers. Retrying...");
                    await GlobalUtils.sleep(30);
                } else {
                    return Promise.reject(`Failed to fetch tickers. ${e}`);
                }
            }
        }

        const res: Array<Market> = [];
        Object.values(tickers as ccxt.Dictionary<ccxt.Ticker>)
            .filter(market => market.percentage !== undefined && market.percentage >= minimumPercent)
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
    public async getCandlesticks(market: string, interval: string, numberOfCandlesticks: number, retries: number): Promise<TOHLCV[]> {
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
                    if (e.message?.toString().includes("DDoSProtection")) {
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
     * @param currencies Array of currencies for which the balance will be retrieved even if it's 0
     * @return A map for each currency where the balance > 0
     */
    public async getBalance(currencies: Array<string>): Promise<Map<string, number>> {
        // TODO maybe add retries or increase the sleep interval
        await GlobalUtils.sleep(2); // it seems like the wallet balance is not updating instantly sometimes
        const balance = await this.binance.fetchBalance()
            .catch(e => Promise.reject(`Failed to fetch wallet balance : ${e}`));
        const res = new Map<string, number>();
        for (const currency of balance.info.balances) {
            if (currencies.indexOf(currency.asset) >= 0 || Number(currency.free) > 0) {
                res.set(currency.asset, Number(currency.free));
            }
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
            .catch(e => Promise.reject(`Failed to fetch balance for currency ${asset}: ${e}`));
        return balance[asset].free;
    }

    /**
     * Converts the array of small amounts of assets in `fromCurrencies` to BNB.
     * Can be executed once every 6 hours
     *
     * @param fromCurrencies The assets to convert
     */
    public async convertSmallAmountsToBNB(fromCurrencies: Array<string>): Promise<void> {
        let assetsInURLPath = "";
        for (const asset of fromCurrencies) {
            if (assetsInURLPath.length === 0) {
                assetsInURLPath += "asset=" + asset;
            } else {
                assetsInURLPath += "&asset=" + asset;
            }
        }
        const headers = {
            'Content-Type': 'application/json',
            'X-MBX-APIKEY': this.binance.apiKey
        };
        const queryString = `${assetsInURLPath}&timestamp=${Date.now()}`;
        const urlPath = `${this.V1_URL_BASE_PATH}/asset/dust?${queryString}`;
        const signature = hmacSHA256(queryString, this.binance.secret).toString();
        axios.post(`${urlPath}&signature=${signature}`, undefined,
            {
                headers: headers
            }).then((response: any) => log.debug("%O HTTP status %O", response.response?.data, response.response?.status))
            .catch((error: any) => log.error("%O HTTP status %O", error.response?.data, error.response?.status));
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
        if (this.configService.isSimulation()) {
            const o = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, side);
            log.info(`Executing simulated order %O`, o);
            return Promise.resolve(o);
        }
        if (amount.toString().split(".")[1]?.length > 8) {
            amount = Math.trunc(amount * Math.pow(10, 8))/Math.pow(10, 8); // 8 digits after comma without rounding
        }

        log.debug("Creating new market order on %O/%O of %O%O", targetAsset, originAsset, amount, targetAsset);
        let binanceOrder;
        try {
            binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                "market", side, amount);
        } catch (e) {
            log.error(`Failed to execute ${side} market order of ${amount} on market ${targetAsset}/${originAsset}. ${e}`);
        }
        if (!binanceOrder && retries && amountToInvest) {
            while (retries-- > 0) {
                try {
                    const unitPrice = await this.getUnitPrice(originAsset, targetAsset, true);
                    amount = amountToInvest/unitPrice;
                    if (amount.toString().split(".")[1]?.length > 8) {
                        amount = Math.trunc(amount * Math.pow(10, 8))/Math.pow(10, 8); // 8 digits after comma without rounding
                    }
                    binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                        "market", side, amount);
                } catch (e) {
                    if (retries > 0) {
                        log.warn(`Failed to execute ${side} market order of ${amount} on market ${targetAsset}/${originAsset}: ${e}. Retrying...`);
                        await GlobalUtils.sleep(3);
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
            filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled, OrderType.MARKET, side, targetAsset),
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
        if (this.configService.isSimulation()) {
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
            log.error(`Failed to execute stop limit order of ${amount} on ${targetAsset}/${originAsset}: ${e}`);
        }
        if (!binanceOrder && retries) {
            while (retries-- > 0) {
                try {
                    binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                        "STOP_LOSS_LIMIT", side, amount, limitPrice, {
                            stopPrice: stopPrice
                        });
                } catch (e) {
                    log.error("Failed to create order : ", e);
                    if (retries > 0) {
                        await GlobalUtils.sleep(3);
                        log.debug("Retrying ...");
                    }
                }
            }
        }

        if (!binanceOrder) {
            return Promise.reject(`Failed to execute ${side} stop limit order of ${amount} on market ${targetAsset}/${originAsset}`);
        }

        const order: Order = {
            id: uuidv4(),
            externalId: binanceOrder.id,
            amountOfTargetAsset: amount,
            stopPrice,
            limitPrice,
            filled: binanceOrder.filled, // TODO: verify if we have to recalculate like for market orders (probably not because the price is fixed)
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
        if (this.configService.isSimulation()) {
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
        if (this.configService.isSimulation()) {
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
                    filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled, orderType, binanceOrder.side, targetAsset),
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
        if (this.configService.isSimulation()) {
            const o = SimulationUtils.getSimulatedCancelOrder();
            log.info(`Executing simulated cancel order %O`, o);
            return Promise.resolve(o);
        }
        const binanceOrder = await this.binance.cancelOrder(orderId, `${targetAsset}/${originAsset}`)
            .catch(e => Promise.reject(e));
        let order: Order = {
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
        while (order.status !== "canceled") {
            try {
                // the OrderType.MARKET here has no importance
                order = await this.getOrder(order.externalId, originAsset, targetAsset, order.id, OrderType.MARKET);
            } catch (e) {
                log.warn(`Failed to get the cancelled order ${order.externalId} : ${e}`);
            }
            await GlobalUtils.sleep(2);
        }
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
     * Finds candlesticks for each market.
     */
    public async fetchCandlesticks(markets: Array<Market>, interval: string, numberOfCandleSticks: number): Promise<void> {
        log.info(`Fetching candlesticks for ${markets.length} markets`);
        if (numberOfCandleSticks > 1000) {
            log.warn("Binance API limits maximum number of candlesticks to fetch to 1000 per request");
        }
        const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_grey);
        progress.start(markets.length, 0);
        let index = 0;
        const oneThird = ~~(markets.length/3);
        async function firstHalf(apiConnector: BinanceConnector) {
            for (let i = 0; i < oneThird; i++) {
                const market = markets[i];
                progress.update(++index);
                market.candleSticks = await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 3);
            }
        }
        async function secondHalf(apiConnector: BinanceConnector) {
            for (let i = oneThird; i < oneThird * 2; i++) {
                const market = markets[i];
                progress.update(++index);
                market.candleSticks = await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 3);
            }
        }
        async function thirdHalf(apiConnector: BinanceConnector) {
            for (let j = oneThird * 2; j < markets.length; j++) {
                const market = markets[j];
                progress.update(++index);
                market.candleSticks = await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 3);
            }
        }
        // if this method ends faster than around 6 seconds then we reach a limit for binance API calls per minute
        await Promise.all([firstHalf(this),
            secondHalf(this),
            thirdHalf(this),
            GlobalUtils.sleep(6)]);
        progress.stop();
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
            // 0.0001% is the default binance transaction fee
            // see https://www.binance.com/en/fee/schedule or in the account settings
            return binanceOrder.cost - Number((binanceOrder.cost * 0.0001).toFixed(9));
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
     * @return Amount of target asset that was purchased when commission is deduced (for MARKET orders)
     */
    private static computeAmountOfFilledAsset(binanceOrder: ccxt.Order, filled: number, orderType: OrderType,
        side: "buy" | "sell", targetAsset: string): number {
        if (orderType !== OrderType.MARKET) {
            return filled;
        }

        const fills: [MarketOrderFill] | undefined = binanceOrder.info?.fills;
        if (!fills) {
            return filled;
        }
        let amountOfOriginAsset = 0;
        for (const fill of fills) {
            if (side === "sell" || fill.commissionAsset !== targetAsset) { // sometimes the commission is in a different currency
                amountOfOriginAsset += Number(fill.qty);
            } else {
                amountOfOriginAsset += Number(fill.qty) - Number(fill.commission);
            }
        }
        return amountOfOriginAsset;
    }

}

