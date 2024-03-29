import ccxt from "ccxt";
import log from '../logging/log.instance';
import { Market, TOHLCVF } from "../models/market";
import { Order } from "../models/order";
import { Currency } from "../enums/trading-currencies.enum";
import { OrderType } from "../enums/order-type.enum";
import { GlobalUtils } from "../utils/global-utils";
import { v4 as uuidv4 } from "uuid";
import { SimulationUtils } from "../utils/simulation-utils";
import cliProgress from "cli-progress";
import { ConfigService } from "../services/config-service";
import { injectable } from "tsyringe";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";
import assert from "assert";
import { RedeemOrder } from "../models/redeem-order";
import { BinanceUtils } from "../utils/binance-utils";
import { NumberUtils } from "../utils/number-utils";
import { Account } from "../models/account";
import { StrategyUtils } from "../utils/strategy-utils";

const axios = require('axios').default;


/**
 * This service is responsible for communicating with Binance API.
 *
 * It is a wrapper around ccxt library with possibly additional/custom implementations.
 */
@injectable()
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
    private binance;

    private readonly V1_URL_BASE_PATH = "https://api.binance.com/sapi/v1";
    private readonly V3_URL_BASE_PATH = "https://api.binance.com/api/v3";

    private headers = {};

    constructor(private configService: ConfigService) {
        this.binance = new ccxt.binance();
    }

    public setup(account: Account): void {
        this.binance = new ccxt.binance({
            apiKey: account.apiKey,
            secret: account.apiSecret,
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
        let retries = 30;
        while (!tickers && retries-- > -1) {
            try {
                tickers = await this.binance.fetchTickers();
            } catch (e) {
                if (retries > -1) {
                    log.warn("Failed to fetch 24h tickers. Retrying...");
                    await GlobalUtils.sleep(180);
                } else {
                    log.error("Could not fetch tickers");
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
    public async getCandlesticks(market: string, interval: string, numberOfCandlesticks: number, retries: number): Promise<TOHLCVF[]> {
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
                    if ((e as any).message?.toString().includes("DDoSProtection")) {
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
     * @param sleepBeforeFetch Boolean indicating whether the method should sleep for 2 seconds before fetching the balance.
     * Because it seems like the wallet balance is not updating instantly sometimes
     * @return A map for each requested currency
     */
    public async getBalance(assets: Array<string>, retries: number, sleepBeforeFetch?: boolean): Promise<Map<string, number>> {
        assert(retries > 0, "`retries` must be a positive number");
        let balance: ccxt.Balances;
        while (retries-- > -1) {
            if (sleepBeforeFetch) {
                await GlobalUtils.sleep(2);
            }
            try {
                balance = await this.binance.fetchBalance();
            } catch (e) {
                log.error(`Failed to fetch wallet balance : ${e}`);
                if (retries == -1) {
                    return Promise.reject(`Failed to fetch wallet balance for ${JSON.stringify(assets)} after ${Math.abs(retries) + 2} retries. ${e}`);
                }
            }
        }

        const res = new Map<string, number>();
        for (const currency of balance!.info.balances) {
            if (assets.indexOf(currency.asset) >= 0) {
                res.set(currency.asset, Number(currency.free));
            }
        }
        return res;
    }

    /**
     * @return Available balance for asset
     */
    public async getBalanceForAsset(asset: string, retries: number): Promise<number> {
        await GlobalUtils.sleep(5); // it seems like the wallet balance is not updating instantly sometimes
        while (retries-- > -1) {
            try {
                const balance = await this.binance.fetchBalance();
                return balance[asset].free;
            } catch (e) {
                log.error(`Failed to fetch balance for currency ${asset}: ${e}`);
                await GlobalUtils.sleep(1);
            }
        }
        return Promise.reject(`Failed to fetch balance for currency ${asset}`);
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
        const url = BinanceUtils.generateURL(`${this.V1_URL_BASE_PATH}/asset/dust`, assetsInURLPath, this.binance.secret);
        try {
            await axios.post(url, undefined, { headers: this.headers });
            success = true;
        } catch (e) {
            log.warn(`Error after HTTP call when converting small amounts: ${JSON.stringify((e as any).response?.data)}. Full exception: ${JSON.stringify(e)}`);
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
        awaitCompletion?: boolean, retries?: number, amountToInvest?: number, marketAmountPrecision?: number, simulation?: boolean): Promise<Order> {
        if (this.configService.isLocalSimulation() || simulation) {
            const currentMarketPrice = await this.getUnitPrice(originAsset, targetAsset, false, 5)
                .catch(e => Promise.reject(e));
            const o = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, side, currentMarketPrice, amountToInvest, amount);
            log.info(`Executing simulated order ${JSON.stringify(o)}`);
            return Promise.resolve(o);
        }
        amount = NumberUtils.truncateNumber(amount, marketAmountPrecision ?? 8);
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
                        amount = NumberUtils.truncateNumber(amount, marketAmountPrecision ?? 8);
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
            datetime: BinanceUtils.toBelgianDateTime(binanceOrder.datetime),
            type: OrderType.MARKET,
            info: binanceOrder.info
        }
        return this.waitMarketOrderCompletion(awaitCompletion, order, originAsset, targetAsset, orderCompletionRetries);
    }

    /**
     * Redeems BLVT token by calling Binance API directly
     * @param targetAsset Example "BNBUP"
     * @param amount Example amount of "BNBUP" that we want to sell/redeem
     * @param retries
     */
    public async redeemBlvt(targetAsset: string, amount: number, retries: number): Promise<RedeemOrder> {
        const query = `tokenName=${targetAsset}&amount=${amount}`;
        const url = BinanceUtils.generateURL(`${this.V1_URL_BASE_PATH}/blvt/redeem`, query, this.binance.secret);
        let redeemOrder;

        while ((!redeemOrder || redeemOrder.status !== 200) && retries-- > -1) {
            try {
                redeemOrder = await axios.post(url, undefined, { headers: this.headers });
                log.debug(`Response received for redeem BLVT : ${JSON.stringify(redeemOrder.data)}`)
            } catch (e) {
                log.error(`Error when redeeming BLVT: ${JSON.stringify((e as any).response?.data)}. Full exception: ${JSON.stringify(e)}`);
            }

            if (redeemOrder && redeemOrder.status === 200) {
                const order: RedeemOrder = {
                    externalId: String(redeemOrder.data.id),
                    amount: Number(redeemOrder.data.amount), // commissions are already counted so no need to calculate
                    redeemAmount: Number(redeemOrder.data.redeemAmount),
                    status: redeemOrder.data.status,
                    targetAsset: redeemOrder.data.tokenName,
                    timestamp: redeemOrder.data.timestamp
                }
                return Promise.resolve(order);
            } else if (redeemOrder && redeemOrder.status !== 200) {
                log.error(`Received response from binance : ${JSON.stringify(redeemOrder)}`);
            }
        }

        return Promise.reject(undefined);
    }

    /**
     * Creates market buy order.
     *
     * @param originAsset
     * @param targetAsset
     * @param quoteAmount If market is BNB/EUR then this represents the amount of EUR that we want to spend
     * @param awaitCompletion
     * @param retries
     * @param simulation In case if a particular strategy wants to use simulated orders
     */
    public async createMarketBuyOrder(originAsset: Currency, targetAsset: string, quoteAmount: number,
        awaitCompletion?: boolean, retries?: number, simulation?: boolean): Promise<Order> {
        if (this.configService.isLocalSimulation() || simulation) {
            const currentMarketPrice = await this.getUnitPrice(originAsset, targetAsset, false, 5)
                .catch(e => Promise.reject(e));
            const o = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, "buy", currentMarketPrice, quoteAmount);
            log.info(`Executing simulated order ${JSON.stringify(o)}`);
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

        return this.waitMarketOrderCompletion(awaitCompletion, binanceOrder, originAsset, targetAsset, orderCompletionRetries);
    }

    /**
     * Creates a BUY MARKET order by calling Binance API directly
     */
    private async createBuyMarketOrderOnBinance(originAsset: Currency, targetAsset: string, amountOfQuoteCurrency: number): Promise<Order> {
        const query = `symbol=${targetAsset}${originAsset.toString()}&side=BUY&type=MARKET&quoteOrderQty=${amountOfQuoteCurrency}`;
        const url = BinanceUtils.generateURL(`${this.V3_URL_BASE_PATH}/order`, query, this.binance.secret);
        let binanceOrder;

        try {
            binanceOrder = await axios.post(url, undefined, { headers: this.headers });
        } catch (e) {
            log.error(`Error when creating market buy order: ${JSON.stringify((e as any).response?.data)}. Full exception: ${JSON.stringify(e)}`);
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
                datetime: BinanceUtils.toBelgianDateTime(binanceOrder.data.transactTime),
                average: BinanceUtils.computeAveragePrice(binanceOrder.data.fills)
            }
            return Promise.resolve(order);
        } else if (binanceOrder && binanceOrder.status !== 200) {
            log.error(`Received response from binance : ${JSON.stringify(binanceOrder)}`);
        }

        return Promise.reject(undefined);
    }


    /**
     * Creates market sell order.
     *
     * @param originAsset e.g. BUSD
     * @param targetAsset
     * @param amount If market is BNB/EUR then this represents the quantity of BNB to sell
     * @param awaitCompletion
     * @param retries
     */
    public async createMarketSellOrder(originAsset: Currency, targetAsset: string, amount: number,
        awaitCompletion?: boolean, retries?: number, marketAmountPrecision?: number, simulation?: boolean): Promise<Order> {
        if (this.configService.isLocalSimulation() || simulation) {
            const currentMarketPrice = await this.getUnitPrice(originAsset, targetAsset, false, 5)
                .catch(e => Promise.reject(e));
            const o = SimulationUtils.getSimulatedMarketOrder(originAsset, targetAsset, "sell", currentMarketPrice, undefined, amount);
            log.info(`Executing simulated order ${JSON.stringify(o)}`);
            return Promise.resolve(o);
        }

        log.debug("Creating new sell market order on %O/%O of %O %O", targetAsset, originAsset, amount, targetAsset);
        let binanceOrder;
        const orderCompletionRetries = 3;
        amount = NumberUtils.truncateNumber(amount, marketAmountPrecision ?? 8);

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
            amountOfOriginAsset: BinanceConnector.computeAmountOfOriginAsset(binanceOrder, binanceOrder.remaining, OrderType.MARKET, "sell"),
            status: binanceOrder.status,
            originAsset,
            targetAsset,
            side: "sell",
            datetime: BinanceUtils.toBelgianDateTime(binanceOrder.datetime),
            type: OrderType.MARKET,
            info: binanceOrder.info
        }
        return this.waitMarketOrderCompletion(awaitCompletion, order, originAsset, targetAsset, orderCompletionRetries);
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
        stopPrice: number, limitPrice: number, retries?: number, simulation?: boolean): Promise<Order> {
        if (this.configService.isLocalSimulation() || simulation) {
            const simulatedOrder: Order = SimulationUtils.getSimulatedStopLimitOrder(originAsset, targetAsset, side, stopPrice, limitPrice);
            log.info(`Executing simulated order ${JSON.stringify(simulatedOrder)}`);
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
            datetime: BinanceUtils.toBelgianDateTime(binanceOrder.datetime),
            type: OrderType.STOP_LIMIT,
            info: binanceOrder.info
        }

        log.debug(`Created ${order.type} order : ${JSON.stringify(order)}`);
        return order;
    }

    /**
     * Creates a sell limit order.
     */
    public async createLimitSellOrder(originAsset: Currency, targetAsset: string, amount: number,
        limitPrice: number, retries?: number): Promise<Order> {
        if (this.configService.isLocalSimulation()) {
            const simulatedOrder: Order = SimulationUtils.getSimulatedLimitOrder(originAsset, targetAsset, "sell");
            log.info(`Executing simulated order ${JSON.stringify(simulatedOrder)}`);
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
            datetime: BinanceUtils.toBelgianDateTime(binanceOrder.datetime),
            type: OrderType.LIMIT,
            info: binanceOrder.info
        }

        log.debug(`Created ${order.type} order : ${JSON.stringify(order)}`);
        return order;
    }

    /**
     * Resolves only when the order's status changes to `closed` or number of `retries` reaches 0
     * @return {@link Order} if it has been closed and `undefined` if still not after x `retries`
     */
    public async waitForOrderCompletion(order: Order, originAsset: Currency, targetAsset: string, retries: number): Promise<Order | undefined> {
        if (this.configService.isLocalSimulation()) {
            return Promise.resolve(undefined);
        }
        if (order.status === "closed") {
            log.debug("Skipping order completion waiting as it is already complete");
            return Promise.resolve(order);
        }
        while (retries-- > -1) {
            log.debug("Waiting for order completion");
            try {
                order = await this.getOrder(order.externalId, originAsset, targetAsset, order.id, order.type!, undefined, true);
                log.debug("Order %O with status %O was found", order.externalId, order.status);
                if (order.status === "closed") {
                    return Promise.resolve(order);
                }
            } catch (e) {
                log.error(`Failed to get order with binance id ${order.externalId} : `, e);
            }
            await GlobalUtils.sleep(2);
        }
        return undefined;
    }

    /**
     * @return Order information
     * @param retries The number of times that the request is retried in case of failure
     * @param verbose If `true` then more information is printed to console
     */
    public async getOrder(externalId: string, originAsset: Currency, targetAsset: string,
        internalOrderId: string, orderType: OrderType, retries?: number, verbose?: boolean, simulation?: boolean) : Promise<Order> {
        if (this.configService.isLocalSimulation() || simulation) {
            return SimulationUtils.getSimulatedGetOrder(originAsset, targetAsset);
        }
        if (verbose) {
            log.debug(`Getting information about binance order ${externalId}`);
        }

        let binanceOrder;
        try {
            binanceOrder = await this.binance.fetchOrder(externalId, `${targetAsset}/${originAsset}`);
        } catch (e) {
            log.error(`Error while getting order ${externalId}`, e);
        }
        while (retries !== undefined && !binanceOrder && retries-- > 0) {
            await GlobalUtils.sleep(2);
            try {
                binanceOrder = await this.binance.fetchOrder(externalId, `${targetAsset}/${originAsset}`);
                if (verbose) {
                    log.debug(`Fetched information about order : ${JSON.stringify(binanceOrder)}`);
                }
            } catch (e) {
                log.error(`Error while getting order ${externalId}`, e);
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
            datetime: BinanceUtils.toBelgianDateTime(binanceOrder.datetime),
            info: binanceOrder.info,
            originAsset,
            targetAsset
        };
        return order;
    }

    /**
     * @return `true` if order is closed/canceled or `false` otherwise
     */
    public async orderIsClosed(externalId: string, originAsset: Currency, targetAsset: string,
        internalOrderId: string, orderType: OrderType, retries?: number, verbose?: boolean, simulation?: boolean): Promise<boolean> {
        const order = await this.getOrder(externalId, originAsset, targetAsset, internalOrderId,
            orderType, retries, verbose, simulation).catch(e => Promise.reject(e));
        return Promise.resolve(order.status !== "open");
    }

    /**
     * @return The cancelled order
     */
    public async cancelOrder(externalOrderId: string, internalOrderId: string, originAsset: Currency, targetAsset: string,
        retries: number, simulation?: boolean) : Promise<Order> {
        if (this.configService.isLocalSimulation() || simulation) {
            const o = SimulationUtils.getSimulatedCancelOrder();
            log.info(`Executing simulated cancel order ${JSON.stringify(o)}`);
            return Promise.resolve(o);
        }
        let inputRetries = retries;
        let canceledOrder: Order | undefined;
        while (!canceledOrder && retries-- > -1) {
            try {
                const binanceOrder = await this.binance.cancelOrder(externalOrderId, `${targetAsset}/${originAsset}`);
                canceledOrder = {
                    externalId: binanceOrder.id,
                    id: internalOrderId,
                    side: binanceOrder.side,
                    amountOfTargetAsset: binanceOrder.amount,
                    filled: binanceOrder.filled,
                    remaining: binanceOrder.remaining,
                    average: binanceOrder.average!,
                    status: binanceOrder.status,
                    datetime: BinanceUtils.toBelgianDateTime(binanceOrder.datetime),
                    info: binanceOrder.info,
                    originAsset,
                    targetAsset
                };
            } catch (e) {
                log.warn(`Failed to cancel order : ${e}`);
                const closedOrder = await this.getOrder(externalOrderId, originAsset, targetAsset, internalOrderId, OrderType.STOP_LIMIT, retries); // the OrderType has no importance
                if (closedOrder.status !== "open") {
                    log.info(`Can't cancel order ${externalOrderId} as it's already ${closedOrder.status}`);
                    return Promise.resolve(closedOrder);
                }
            }
        }
        if (!canceledOrder) {
            return Promise.reject(`Failed to cancel order ${externalOrderId}`);
        }
        if (canceledOrder.status === "canceled") {
            return Promise.resolve(canceledOrder);
        }
        while (canceledOrder.status !== "canceled" && inputRetries-- > -1) {
            try {
                canceledOrder = await this.getOrder(canceledOrder.externalId, originAsset, targetAsset, canceledOrder.id, OrderType.STOP_LIMIT, retries); // the OrderType has no importance
                if (canceledOrder.status === "canceled") {
                    log.debug(`Cancelled order : ${JSON.stringify(canceledOrder)}`);
                    return Promise.resolve(canceledOrder);
                }
            } catch (e) {
                log.error(`Failed to get the cancelled order ${canceledOrder.externalId} : ${e}`);
            }
            await GlobalUtils.sleep(2);
        }
        return Promise.reject(`Failed to cancel order : ${JSON.stringify(canceledOrder)}`);
    }

    public setMarketAdditionalParameters(markets: Array<Market>): void {
        // fori and not a for of loop is needed because the array's content is modified in the loop
        for (let i = 0; i < markets.length; i++) {
            BinanceUtils.setMarketMinNotional(markets[i], this.binance.markets);
            BinanceUtils.setMarketAmountPrecision(markets[i], this.binance.markets);
            BinanceUtils.setPricePrecision(markets[i], this.binance.markets);
            BinanceUtils.setMaxPosition(markets[i], this.binance.markets);
            BinanceUtils.setQuoteOrderQtyMarketAllowed(markets[i], this.binance.markets);
        }
    }

    /**
     * Retrieves and sets candlesticks for each market.
     * @param numberOfCandleSticks Must not exceed 1000 (limited by Binance)
     */
    public async fetchCandlesticks(markets: Array<Market>, interval: CandlestickInterval, numberOfCandleSticks: number): Promise<void> {
        if (this.configService.isLocalSimulation()) {
            log.info(`Fetching candlesticks for ${markets.length} markets`);
        }
        if (numberOfCandleSticks > 1000) {
            log.warn("Binance API limits maximum number of candlesticks to fetch to 1000 per request");
        }
        const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_grey);
        progress.start(markets.length, 0);
        let index = 0;
        const oneFifth = ~~(markets.length/5);
        async function getHalf(apiConnector: BinanceConnector, startIndex: number, endIndex: number) {
            for (let i = startIndex; i < endIndex; i++) {
                const market = markets[i];
                progress.update(++index);
                market.candleStickIntervals.push(interval);
                const candles = await apiConnector.getCandlesticks(market.symbol, interval, numberOfCandleSticks, 10)
                    .catch(e => Promise.reject(e));
                candles[candles.length - 1].push(BinanceConnector.getFetchingTimestamp(candles[candles.length - 1])); // the last candlestick contains additional fetching date timestamp
                market.candleSticks = new Map([[interval, candles]]);
            }
        }
        const start = new Date();
        // If this method ends faster than around 6 seconds then we exceed the limit for binance API calls per minute
        // The tested speed with 205 markets is between 15 - 20 seconds,
        // during this time the request weight reaches around 860
        await Promise.all([
            getHalf(this, 0, oneFifth),
            getHalf(this, oneFifth, oneFifth * 2),
            getHalf(this, oneFifth * 2, oneFifth * 3),
            getHalf(this, oneFifth * 3, oneFifth * 4),
            getHalf(this, oneFifth * 4, markets.length),
            GlobalUtils.sleep(this.configService.isLocalSimulation() ? 0 : 6)]).catch(e => Promise.reject(e));
        const stop = new Date();
        if ((stop.getTime() - start.getTime())/1000 >= 30) {
            log.warn(`Fetching candlesticks took ${(stop.getTime() - start.getTime())/1000} seconds`);
        }
        progress.stop();
    }

    private static getFetchingTimestamp(lastCandlestick: TOHLCVF): number {
        assert(CandlestickInterval.DEFAULT === CandlestickInterval.FIVE_MINUTES, "If the default interval is not 5min then this" +
            "method has to be adapted");
        const currentDate = new Date();
        const secondsDifference = StrategyUtils.getSecondsDifferenceBetweenDates(currentDate, new Date(lastCandlestick[0]));
        if (secondsDifference < 300) {
            // if it was fetched between e.g. 0 and 4:59 then nothing to do
        } else {
            // if the candlestick timestamp starts at 0 minutes but it was fetched at 4:59 and now it's >= 5:00
            // then we set the date to previous minute
            // example 1: candlestick timestamp = 4:xx, currentDate = 5:00
            // => currentDate.setSeconds(299 - 300) => currentDate.setSeconds(-1) => currentDate = 4:59

            // example 2: candlestick timestamp = 4:xx, currentDate = 5:01
            // => currentDate.setSeconds(299 - 301)) => currentDate.setSeconds(-2) => currentDate = 4:58
            currentDate.setSeconds(299 - secondsDifference);
        }
        return currentDate.getTime();
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
            return binanceOrder.cost - NumberUtils.truncateNumber(binanceOrder.cost * 0.001, 8);
        }

        const fills: [MarketOrderFill] | undefined = binanceOrder.info?.fills;
        if (!fills) {
            log.warn("Fills details were not found");
            return binanceOrder.average! * (binanceOrder.filled + binanceOrder.remaining);
        }
        let amountOfOriginAsset = 0;
        for (const fill of fills) {
            if (side === "buy" || fill.commissionAsset !== Currency.BUSD.toString()) {
                // for BUY orders no need to deduce commission because we calculate the total
                // amount of origin asset that was spent and it already includes the commission
                amountOfOriginAsset += Number(fill.price) * Number(fill.qty);
            } else {
                amountOfOriginAsset += Number(fill.price) * Number(fill.qty) - Number(fill.commission);
            }
        }
        amountOfOriginAsset = NumberUtils.truncateNumber(amountOfOriginAsset, 8);
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
        return NumberUtils.truncateNumber(amountOfTargetAsset, 8);
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
export interface MarketOrderFill {
    price: string,
    qty: string,
    commission: string,
    commissionAsset: string
}
