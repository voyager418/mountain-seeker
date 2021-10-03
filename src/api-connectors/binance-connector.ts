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
import { CandlestickInterval } from "../enums/candlestick-interval.enum";
import assert from "assert";

const axios = require('axios').default;


/**
 * This service is responsible for communicating with Binance API.
 *
 * It is a wrapper around ccxt library with possibly additional/custom implementations.
 */
@singleton()
export class BinanceConnector {

    /** Binance ccxt instance.
     * Binance API and others have rate limits for requests.
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
    private readonly V3_URL_BASE_PATH = "https://api.binance.com/api/v3";

    private readonly headers = {};

    constructor(private configService: ConfigService) {
        this.binance = new ccxt.binance({
            apiKey: process.env.BINANCE_API_KEY,
            secret: process.env.BINANCE_API_SECRET,
            verbose: false,
            enableRateLimit: false
        });
        this.headers = {
            'Content-Type': 'application/json',
            'X-MBX-APIKEY': this.binance.apiKey
        };
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
                candleSticks: new Map(),
                candleSticksPercentageVariations: new Map(),
                candleStickIntervals: [] }));
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
                    await GlobalUtils.sleep(10);
                }
            }
        }
        return Promise.reject(`Failed to fetch candle sticks.`);
    }

    /**
     * @param assets Array of assets for which the balance will be retrieved even if it's 0
     * @param retries
     * @return A map for each requested currency
     */
    public async getBalance(assets: Array<string>, retries: number): Promise<Map<string, number>> {
        assert(retries > 0, "`retries` must be a positive number");
        let balance;
        while (retries-- > -1) {
            await GlobalUtils.sleep(2); // it seems like the wallet balance is not updating instantly sometimes
            try {
                balance = await this.binance.fetchBalance();
            } catch (e) {
                log.error(`Failed to fetch wallet balance : ${e}`);
            }
        }
        if (!balance) {
            return Promise.reject(`Failed to fetch wallet balance for ${JSON.stringify(assets)} after ${Math.abs(retries) + 1} retries`);
        }

        const res = new Map<string, number>();
        for (const currency of balance.info.balances) {
            if (assets.indexOf(currency.asset) >= 0) {
                res.set(currency.asset, Number(currency.free));
            }
        }
        return res;
    }

    /**
     * @return Available balance for asset
     */
    public async getBalanceForAsset(asset: string): Promise<number> {
        await GlobalUtils.sleep(5); // it seems like the wallet balance is not updating instantly sometimes
        const balance = await this.binance.fetchBalance()
            .catch(e => Promise.reject(`Failed to fetch balance for currency ${asset}: ${e}`));
        return balance[asset].free;
    }

    /**
     * Converts the array of small amounts of assets in `fromCurrencies` to BNB.
     * Can be executed once every 6 hours otherwise Binance throws an error.
     *
     * @param fromCurrencies The assets to convert
     */
    public async convertSmallAmountsToBNB(fromCurrencies: Array<string>): Promise<boolean> {
        let success = false;
        let assetsInURLPath = "";
        for (const asset of fromCurrencies) {
            if (assetsInURLPath.length === 0) {
                assetsInURLPath += "asset=" + asset;
            } else {
                assetsInURLPath += "&asset=" + asset;
            }
        }
        const url = this.generateURL(`${this.V1_URL_BASE_PATH}/asset/dust`, assetsInURLPath);
        try {
            await axios.post(url, undefined, { headers: this.headers });
            success = true;
        } catch (e) {
            log.warn(`Error after HTTP call when converting small amounts: ${JSON.stringify(e)}`);
        }
        return Promise.resolve(success);
    }

    /**
     * This method always returns a valid result or exits with an error.
     * @return A number that stands for the amount of `inAsset` needed to buy 1 unit of `ofAsset`
     */
    public async getUnitPrice(inAsset: Currency, ofAsset: string, verbose: boolean, retries: number): Promise<number> {
        assert(retries > 0, "retries must not be zero")
        const marketSymbol = ofAsset.toString() + '/' + inAsset.toString();
        let lastPrice: number | undefined = undefined;
        while (!lastPrice && retries-- > 0) {
            await this.binance.fetchTicker(marketSymbol)
                .then(market => lastPrice = market.last)
                .catch(error => log.error(`Failed to get information for ${marketSymbol} market. ${error}`));
            if (retries > 0 && !lastPrice) {
                log.info(`Last price of ${marketSymbol} was not found, retrying...`);
                await GlobalUtils.sleep(5);
            }
        }
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
     * @param originAsset Asset used to buy {@link targetAsset} when {@link side} == "buy" or that is retrieved when {@link side} == "sell"
     * @param targetAsset Asset that will be sold or bought
     * @param side Specifies the buy or sell order
     * @param amount Amount of {@link targetAsset} that we want to buy when {@link side} == "buy" or the amount of {@link targetAsset}
     * to sell when {@link side} == "sell"
     * @param awaitCompletion If `true` then there will be a delay in order to wait for the order status to
     * change from `open` to `closed`
     * @param retries Indicates the number of times the order will be repeated after a failure
     * @param amountToInvest The number of origin asset that is going to be invested. Needed to recalculate the {@link amount} in case of sudden price move
     * @param marketAmountPrecision Stands for the number of digits after the dot that the market authorises to use and
     * uses it to truncate the {@link amount}
     */
    public async createMarketOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell", amount: number,
        awaitCompletion?: boolean, retries?: number, amountToInvest?: number, marketAmountPrecision?: number): Promise<Order> {
        if (this.configService.isSimulation()) {
            const o = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, side);
            log.info(`Executing simulated order %O`, o);
            return Promise.resolve(o);
        }
        amount = GlobalUtils.truncateNumber(amount, marketAmountPrecision ?? 8);
        const orderCompletionRetries = 3;

        log.debug("Creating new %O market order on %O/%O of %O %O", side, targetAsset, originAsset, amount, targetAsset);
        let binanceOrder;
        try {
            binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                "market", side, amount);
        } catch (e) {
            log.error(`Failed to execute ${side} market order of ${amount} on market ${targetAsset}/${originAsset}. ${e}`);
        }
        if (!binanceOrder && retries) {
            // This variable is used to decrease the amount price by small steps in case of a InsufficientFunds exception in a buy order.
            // This scenario happens when the market price is quickly changing.
            let percentDecreaseMultiplier = 1;

            while (retries-- > 0 && !binanceOrder) {
                await GlobalUtils.sleep(3);
                log.debug("Creating new market order on %O/%O of %O %O", targetAsset, originAsset, amount, targetAsset);
                try {
                    if (amountToInvest && side === "buy") {
                        const unitPrice = await this.getUnitPrice(originAsset, targetAsset, true, 10)
                            .catch(error => Promise.reject(error));
                        amount = amountToInvest/unitPrice;
                        amount -= amount * (percentDecreaseMultiplier * 0.004);
                        amount = GlobalUtils.truncateNumber(amount, marketAmountPrecision ?? 8);
                    }
                    binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`, "market", side, amount);
                } catch (e) {
                    log.warn(`Failed to execute ${side} market order of ${amount} on market ${targetAsset}/${originAsset}: ${e}`);
                    percentDecreaseMultiplier++;
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
            filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled, OrderType.MARKET, side, targetAsset, binanceOrder.info?.fills),
            remaining: binanceOrder.remaining,
            average: binanceOrder.average!,
            amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, OrderType.MARKET, side),
            status: binanceOrder.status,
            originAsset,
            targetAsset,
            side,
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            type: OrderType.MARKET,
            info: binanceOrder.info
        }
        return await this.waitMarketOrderCompletion(awaitCompletion, order, originAsset, targetAsset, orderCompletionRetries);
    }

    /**
     * Creates market buy order.
     *
     * @param originAsset
     * @param targetAsset
     * @param quoteAmount If market is BNB/EUR then this represents the amount of EUR that we want to spend
     * @param awaitCompletion
     * @param retries
     */
    public async createMarketBuyOrder(originAsset: Currency, targetAsset: string, quoteAmount: number,
        awaitCompletion?: boolean, retries?: number): Promise<Order> {
        if (this.configService.isSimulation()) {
            const o = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, "buy");
            log.info(`Executing simulated order %O`, o);
            return Promise.resolve(o);
        }

        log.debug("Creating new buy market order on %O/%O of %O %O", targetAsset, originAsset, quoteAmount, originAsset);
        let binanceOrder;
        const orderCompletionRetries = 3;

        try {
            binanceOrder = await this.createBuyMarketOrderOnBinance(originAsset, targetAsset, quoteAmount);
        } catch (e) {
            log.error(`Failed to execute buy market order of ${quoteAmount} on market ${targetAsset}/${originAsset}. ${e}`);
        }
        while (retries !== undefined && !binanceOrder && retries-- > 0) {
            await GlobalUtils.sleep(3);
            log.debug("Creating new buy market order on %O/%O of %O %O", targetAsset, originAsset, quoteAmount, originAsset);
            try {
                binanceOrder = await this.createBuyMarketOrderOnBinance(originAsset, targetAsset, quoteAmount);
            } catch (e) {
                log.warn(`Failed to execute buy market order of ${quoteAmount} on market ${targetAsset}/${originAsset}: ${e}`);
            }
        }
        if (!binanceOrder) {
            return Promise.reject(`Failed to execute buy market order on market ${targetAsset}/${originAsset}`);
        }

        return await this.waitMarketOrderCompletion(awaitCompletion, binanceOrder, originAsset, targetAsset, orderCompletionRetries);
    }

    /**
     * Creates a BUY MARKET order by calling Binance API directly
     */
    private async createBuyMarketOrderOnBinance(originAsset: Currency, targetAsset: string, amountOfQuoteCurrency: number): Promise<Order> {
        const query = `symbol=${targetAsset}${originAsset.toString()}&side=BUY&type=MARKET&quoteOrderQty=${amountOfQuoteCurrency}`;
        const url = this.generateURL(`${this.V3_URL_BASE_PATH}/order`, query);
        let binanceOrder;

        try {
            binanceOrder = await axios.post(url, undefined, { headers: this.headers });
        } catch (e) {
            log.error(`Error when creating market buy order: ${JSON.stringify(e)}`);
        }

        if (binanceOrder && binanceOrder.status === 200) {
            const order: Order = {
                id: uuidv4(),
                externalId: String(binanceOrder.data.orderId),
                amountOfOriginAsset: Number(binanceOrder.data.cummulativeQuoteQty),
                filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled,
                    OrderType.MARKET, "buy", targetAsset, binanceOrder.data.fills),
                amountOfTargetAsset: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled,
                    OrderType.MARKET, "buy", targetAsset, binanceOrder.data.fills),
                remaining: Number(binanceOrder.data.origQty) - Number(binanceOrder.data.executedQty),
                status: binanceOrder.data.status === "FILLED" ? "closed" : "open",
                originAsset,
                targetAsset,
                side: "buy",
                type: OrderType.MARKET,
                info: binanceOrder.data,
                datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.data.transactTime),
                average: BinanceConnector.computeAveragePrice(binanceOrder.data.fills)
            }
            return Promise.resolve(order);
        } else {
            log.error(`Received response from binance : ${JSON.stringify(binanceOrder)}`);
        }

        return Promise.reject(undefined);
    }


    /**
     * Creates market sell order.
     *
     * @param originAsset
     * @param targetAsset
     * @param amount If market is BNB/EUR then this represents the quantity of BNB to sell
     * @param awaitCompletion
     * @param retries
     */
    public async createMarketSellOrder(originAsset: Currency, targetAsset: string, amount: number,
        awaitCompletion?: boolean, retries?: number, marketAmountPrecision?: number): Promise<Order> {
        if (this.configService.isSimulation()) {
            const o = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, "sell");
            log.info(`Executing simulated order %O`, o);
            return Promise.resolve(o);
        }

        log.debug("Creating new sell market order on %O/%O of %O %O", targetAsset, originAsset, amount, targetAsset);
        let binanceOrder;
        const orderCompletionRetries = 3;
        amount = GlobalUtils.truncateNumber(amount, marketAmountPrecision ?? 8);

        try {
            binanceOrder = await this.binance.createMarketSellOrder(`${targetAsset}/${originAsset}`, amount);
        } catch (e) {
            log.error(`Failed to execute sell market order of ${amount} on market ${targetAsset}/${originAsset}. ${e}`);
        }
        while (retries !== undefined && !binanceOrder && retries-- > 0) {
            await GlobalUtils.sleep(3);
            log.debug("Creating new sell market order on %O/%O of %O %O", targetAsset, originAsset, targetAsset);
            try {
                binanceOrder = await this.binance.createMarketSellOrder(`${targetAsset}/${originAsset}`, amount);
            } catch (e) {
                log.warn(`Failed to execute sell market order of ${amount} on market ${targetAsset}/${originAsset}: ${e}`);
            }
        }
        if (!binanceOrder) {
            return Promise.reject(`Failed to execute sell market order on market ${targetAsset}/${originAsset}`);
        }

        const order: Order = {
            id: uuidv4(),
            externalId: binanceOrder.id,
            amountOfTargetAsset: binanceOrder.amount,
            filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled, OrderType.MARKET, "sell", targetAsset, binanceOrder.info?.fills),
            remaining: binanceOrder.remaining,
            average: binanceOrder.average!,
            amountOfOriginAsset: binanceOrder.cost,
            status: binanceOrder.status,
            originAsset,
            targetAsset,
            side: "sell",
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            type: OrderType.MARKET,
            info: binanceOrder.info
        }
        return await this.waitMarketOrderCompletion(awaitCompletion, order, originAsset, targetAsset, orderCompletionRetries);
    }

    private async waitMarketOrderCompletion(awaitCompletion: undefined | boolean, order: Order, originAsset: Currency, targetAsset: string, orderCompletionRetries: number) {
        if (!awaitCompletion) {
            log.debug(`Created binance order : ${JSON.stringify(order)}`);
            return Promise.resolve(order);
        }

        const completedOrder = await this.waitForOrderCompletion(order, originAsset, targetAsset, orderCompletionRetries)
            .catch(e => Promise.reject(e));
        if (!completedOrder) {
            return Promise.reject(`Order ${order.id} still not closed after ${orderCompletionRetries} retries`);
        }
        log.debug(`Created ${order.type} order : ${JSON.stringify(completedOrder)}`);
        return Promise.resolve(completedOrder);
    }

    /**
     * Creates a stop limit order.
     */
    public async createStopLimitOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell", amount: number,
        stopPrice: number, limitPrice: number, retries?: number): Promise<Order> {
        if (this.configService.isSimulation()) {
            const simulatedOrder: Order = SimulationUtils.getSimulatedStopLimitOrder(originAsset, targetAsset, side);
            log.info(`Executing simulated order %O`, simulatedOrder);
            return Promise.resolve(simulatedOrder);
        }

        log.debug("Creating %O stop limit order on %O/%O of %O %O. With stopPrice : %O, limitPrice: %O",
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
        while (retries !== undefined && !binanceOrder && retries-- > 0) {
            await GlobalUtils.sleep(3);
            log.debug("Creating %O stop limit order on %O/%O of %O %O. With stopPrice : %O, limitPrice: %O",
                side, targetAsset, originAsset, amount, targetAsset, stopPrice, limitPrice);
            try {
                binanceOrder = await this.binance.createOrder(`${targetAsset}/${originAsset}`,
                    "STOP_LOSS_LIMIT", side, amount, limitPrice, {
                        stopPrice: stopPrice
                    });
            } catch (e) {
                log.error("Failed to create order : ", e);
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
            average: binanceOrder.average!,
            amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, OrderType.STOP_LIMIT, side),
            status: binanceOrder.status,
            originAsset,
            targetAsset,
            side,
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            type: OrderType.STOP_LIMIT,
            info: binanceOrder.info
        }

        log.debug(`Created ${order.type} order : ${JSON.stringify(order)}`);
        return Promise.resolve(order);
    }

    /**
     * Creates a sell limit order.
     */
    public async createLimitSellOrder(originAsset: Currency, targetAsset: string, amount: number,
        limitPrice: number, retries?: number): Promise<Order> {
        if (this.configService.isSimulation()) {
            const simulatedOrder: Order = SimulationUtils.getSimulatedLimitOrder(originAsset, targetAsset, "sell");
            log.info(`Executing simulated order %O`, simulatedOrder);
            return Promise.resolve(simulatedOrder);
        }

        log.debug("Creating sell limit order on %O/%O of %O %O. With limitPrice: %O",
            targetAsset, originAsset, amount, targetAsset, limitPrice);
        let binanceOrder;
        try {
            binanceOrder = await this.binance.createLimitSellOrder(`${targetAsset}/${originAsset}`, amount, limitPrice);
        } catch (e) {
            log.error(`Failed to execute sell limit order of ${amount} on ${targetAsset}/${originAsset}: ${e}`);
        }
        while (retries !== undefined && !binanceOrder && retries-- > 0) {
            await GlobalUtils.sleep(3);
            log.debug("Creating sell limit order on %O/%O of %O %O. With limitPrice: %O",
                targetAsset, originAsset, amount, targetAsset, limitPrice);
            try {
                binanceOrder = await this.binance.createLimitSellOrder(`${targetAsset}/${originAsset}`, amount, limitPrice);
            } catch (e) {
                log.error("Failed to create order : ", e);
            }
        }

        if (!binanceOrder) {
            return Promise.reject(`Failed to execute sell limit order of ${amount} on market ${targetAsset}/${originAsset}`);
        }

        const order: Order = {
            id: uuidv4(),
            externalId: binanceOrder.id,
            amountOfTargetAsset: amount,
            limitPrice,
            filled: binanceOrder.filled, // TODO: verify if we have to recalculate like for market orders (probably not because the price is fixed)
            remaining: binanceOrder.remaining,
            average: binanceOrder.average!,
            amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, OrderType.LIMIT, "sell"),
            status: binanceOrder.status,
            originAsset,
            targetAsset,
            side: "sell",
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            type: OrderType.LIMIT,
            info: binanceOrder.info
        }

        log.debug(`Created ${order.type} order : ${JSON.stringify(order)}`);
        return Promise.resolve(order);
    }

    /**
     * Resolves only when the order's status changes to `closed` or number of `retries` reaches 0
     * @return {@link Order} if it has been closed and `undefined` if still not after x `retries`
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
        while (!filled && remainingRetries-- > 0) {
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
            await GlobalUtils.sleep(2);
        }
        if (!filled) {
            return Promise.resolve(undefined);
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
        if (this.configService.isSimulation()) {
            const order: Order = SimulationUtils.getSimulatedGetOrder(originAsset, targetAsset);
            log.info(`Executing simulated order %O`, order);
            return Promise.resolve(order);
        }
        if (verbose) {
            log.debug(`Getting information about binance order ${externalId}`);
        }

        let binanceOrder;
        try {
            binanceOrder = await this.binance.fetchOrder(externalId, `${targetAsset}/${originAsset}`);
        } catch (e) {
            log.warn(`Error while getting order ${externalId}`, e);
        }
        while (retries !== undefined && !binanceOrder && retries-- > 0) {
            await GlobalUtils.sleep(2);
            try {
                binanceOrder = await this.binance.fetchOrder(externalId, `${targetAsset}/${originAsset}`);
                if (verbose) {
                    log.debug(`Fetched information about order : ${JSON.stringify(binanceOrder)}`);
                }
            } catch (e) {
                log.warn(`Error while getting order ${externalId}`, e);
            }
        }
        if (!binanceOrder) {
            return Promise.reject(`Order ${externalId} was not found`);
        }

        const order: Order = {
            type: orderType,
            id: internalOrderId,
            externalId: binanceOrder.id,
            side: binanceOrder.side,
            amountOfTargetAsset: binanceOrder.amount,
            filled: BinanceConnector.computeAmountOfFilledAsset(binanceOrder, binanceOrder.filled, orderType, binanceOrder.side, targetAsset, binanceOrder.info?.fills),
            remaining: binanceOrder.remaining,
            average: binanceOrder.average!,
            amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, orderType, binanceOrder.side),
            status: binanceOrder.status,
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            info: binanceOrder.info,
            originAsset,
            targetAsset
        };
        return order;
    }

    /**
     * @return `true` if order is closed or `false` otherwise
     */
    public async orderIsClosed(externalId: string, originAsset: Currency, targetAsset: string,
        internalOrderId: string, orderType: OrderType, retries?: number, verbose?: boolean): Promise<boolean> {
        const order = await this.getOrder(externalId, originAsset, targetAsset, internalOrderId,
            orderType, retries, verbose).catch(e => Promise.reject(e));
        return Promise.resolve(order.status === "closed");
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
            average: binanceOrder.average!,
            status: binanceOrder.status,
            datetime: BinanceConnector.getBelgiumDateTime(binanceOrder.datetime),
            info: binanceOrder.info,
            originAsset,
            targetAsset
        };
        while (order.status !== "canceled") {
            try {
                order = await this.getOrder(order.externalId, originAsset, targetAsset, order.id, OrderType.STOP_LIMIT); // the OrderType has no importance
            } catch (e) {
                log.warn(`Failed to get the cancelled order ${order.externalId} : ${e}`);
            }
            await GlobalUtils.sleep(2);
        }
        log.debug(`Cancelled order : ${JSON.stringify(order)}`);
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
        // fori and not a for of loop is needed because the array's content is modified in the loop
        for (let i = 0; i < markets.length; i++) {
            const amountPrecision = this.binance.markets[markets[i].symbol]?.precision?.amount;
            if (amountPrecision && amountPrecision >= 0) {
                markets[i].amountPrecision = amountPrecision;
            }
        }
    }

    /**
     * Sets the {@link Market.pricePrecision} field
     */
    public setPricePrecision(markets: Array<Market>): void {
        // fori and not a for of loop is needed because the array's content is modified in the loop
        for (let i = 0; i < markets.length; i++) {
            const pricePrecision = this.binance.markets[markets[i].symbol]?.precision?.price;
            if (pricePrecision && pricePrecision >= 0) {
                markets[i].pricePrecision = pricePrecision;
            }
        }
    }

    /**
     * Sets the {@link Market.maxPosition} field
     */
    public setMaxPosition(markets: Array<Market>): void {
        // fori and not a for of loop is needed because the array's content is modified in the loop
        for (let i = 0; i < markets.length; i++) {
            const maxPositionFilter = this.binance.markets[markets[i].symbol]?.info.filters
                .filter((element: { filterType: string; }) => element.filterType === "MAX_POSITION")[0];
            if (maxPositionFilter) {
                markets[i].maxPosition = Number(maxPositionFilter.maxPosition);
            } else {
                markets[i].maxPosition = Infinity;
            }
        }
    }

    /**
     * Sets the {@link Market.quoteOrderQtyMarketAllowed} field
     */
    public setQuoteOrderQtyMarketAllowed(markets: Array<Market>): void {
        // fori and not a for of loop is needed because the array's content is modified in the loop
        for (let i = 0; i < markets.length; i++) {
            const quoteOrderQtyMarketAllowed = this.binance.markets[markets[i].symbol]?.info?.quoteOrderQtyMarketAllowed;
            if (quoteOrderQtyMarketAllowed !== undefined) {
                markets[i].quoteOrderQtyMarketAllowed = quoteOrderQtyMarketAllowed;
            }
        }
    }

    /**
     * Retrieves and sets candlesticks for each market.
     * @param numberOfCandleSticks Must not exceed 1000 (limited by Binance)
     */
    public async fetchCandlesticks(markets: Array<Market>, interval: CandlestickInterval, numberOfCandleSticks: number): Promise<void> {
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
                market.candleStickIntervals.push(interval);
                market.candleSticks = new Map([[interval,
                    await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 10)
                        .catch(e => Promise.reject(e))]]);
            }
        }
        async function secondHalf(apiConnector: BinanceConnector) {
            for (let i = oneThird; i < oneThird * 2; i++) {
                const market = markets[i];
                progress.update(++index);
                market.candleStickIntervals.push(interval);
                market.candleSticks = new Map([[interval,
                    await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 10)
                        .catch(e => Promise.reject(e))]]);
            }
        }
        async function thirdHalf(apiConnector: BinanceConnector) {
            for (let i = oneThird * 2; i < markets.length; i++) {
                const market = markets[i];
                progress.update(++index);
                market.candleStickIntervals.push(interval);
                market.candleSticks = new Map([[interval,
                    await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 10)
                        .catch(e => Promise.reject(e))]]);
            }
        }
        // if this method ends faster than around 6 seconds then we exceed the limit for binance API calls per minute
        await Promise.all([firstHalf(this),
            secondHalf(this),
            thirdHalf(this),
            GlobalUtils.sleep(6)]).catch(e => Promise.reject(e));
        progress.stop();
    }

    /**
     * Used for debug purposes
     */
    public printMarketDetails(market: Market): void {
        log.debug(`Market details from binance : ${JSON.stringify(this.binance.markets[market.symbol], GlobalUtils.replacer, 4)}`);
        log.debug(`Market details from local object : ${JSON.stringify(market, GlobalUtils.replacer, 4)}`);
    }

    /**
     * Converts Binance timestamps into Belgian time
     */
    private static getBelgiumDateTime(date: string): string {
        try {
            const res = new Date(date);
            res.setHours(res.getHours() + 2);
            return res.toISOString();
        } catch (e) {
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

        // for stop-limit orders Binance does not provide commission data so it has to be computed manually
        if (orderType !== OrderType.MARKET) {
            // 0.1% is the default binance transaction fee, see https://www.binance.com/en/fee/schedule or in the account settings
            // If BNB is available then Binance pays the fee from BNB wallet, so the below number is an approximation
            return binanceOrder.cost - GlobalUtils.truncateNumber(binanceOrder.cost * 0.001, 8);
        }

        const fills: [MarketOrderFill] | undefined = binanceOrder.info?.fills;
        if (!fills) {
            log.warn("Fills details were not found");
            return binanceOrder.average! * (binanceOrder.filled + binanceOrder.remaining);
        }
        let amountOfOriginAsset = 0;
        for (const fill of fills) {
            if (side === "buy") {
                // for BUY orders no need to deduce commission because we calculate the total
                // amount of origin asset that was spent and it already includes the commission
                amountOfOriginAsset += Number(fill.price) * Number(fill.qty);
            } else {
                amountOfOriginAsset += Number(fill.price) * Number(fill.qty) - Number(fill.commission);
            }
        }
        amountOfOriginAsset = GlobalUtils.truncateNumber(amountOfOriginAsset, 8);
        return amountOfOriginAsset;
    }

    /**
     * @return Amount of target asset that was purchased when commission is deduced (for MARKET orders)
     */
    private static computeAmountOfFilledAsset(binanceOrder: ccxt.Order, filled: number, orderType: OrderType,
        side: "buy" | "sell", targetAsset: string, fills: [MarketOrderFill] | undefined): number {
        if (orderType !== OrderType.MARKET) {
            return filled;
        }

        if (!fills) {
            return filled;
        }
        let amountOfTargetAsset = 0;
        for (const fill of fills) {
            if (side === "sell" || fill.commissionAsset !== targetAsset) { // sometimes the commission is in BNB so no need to deduce it
                amountOfTargetAsset += Number(fill.qty);
            } else {
                amountOfTargetAsset += Number(fill.qty) - Number(fill.commission);
            }
        }
        return GlobalUtils.truncateNumber(amountOfTargetAsset, 8);
    }

    /**
     * Constructs a URL from a base path and query arguments that includes a signature and a timestamp
     * needed to call private Binance endpoints (like buy order)
     */
    private generateURL(urlBasePath: string, query: string): string {
        const queryString = `${query}&timestamp=${Date.now()}`;
        const urlPath = `${urlBasePath}?${queryString}`;
        const signature = hmacSHA256(queryString, this.binance.secret).toString();
        return `${urlPath}&signature=${signature}`;
    }

    /**
     * Computes average price based on "fills" array that is returned by Binance
     */
    private static computeAveragePrice(fills: [MarketOrderFill]): number {
        let num = 0;
        let denom = 0;
        for (const fill of fills) {
            num += Number(fill.price) * Number(fill.qty);
            denom += Number(fill.qty);
        }
        return GlobalUtils.truncateNumber(num/denom, 8);
    }
}

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
