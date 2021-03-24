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
     * @param awaitCompletion If `true` then this method will return only when the order is totally filled/completed.
     * @return The updated `order` object
     */
    public async createOrder(order: Order, awaitCompletion: boolean) : Promise<Order> {
        // TODO : there is always a minimum amount allowed to buy depending on a market
        //  see https://github.com/ccxt/ccxt/wiki/Manual#precision-and-limits
        if (BinanceConnector.IS_SIMULATION) {
            log.info(`Executing simulated order %O`, order);
            return Promise.resolve(order);
        }

        log.info(`Executing new order %O`, order);
        let binanceOrder;
        switch (order.type) {
        case OrderType.MARKET:
            binanceOrder = await this.binance.createOrder(order.targetAsset + '/' + order.originAsset,
                "market", order.action, order.amount)
                .catch(e => Promise.reject(`Failed to execute ${JSON.stringify(order)} order. ${e}`));
            break;
        case OrderType.STOP_LOSS_LIMIT:
            assert(order.stopPrice !== undefined, "Stop price must be provided for stop-limit orders");
            // TODO : "it would be safer for you to set the stop price (trigger price) a bit higher than the limit
            //  price (for sell orders) or a bit lower than the limit price (for buy orders). This increases the
            //  chances of your limit order getting filled after the stop-limit is triggered."
            //   See https://academy.binance.com/en/articles/what-is-a-stop-limit-order
            binanceOrder = await this.binance.createOrder(order.targetAsset + '/' + order.originAsset,
                "STOP_LOSS_LIMIT", order.action, order.amount, order.limitPrice, {
                    stopPrice: order.stopPrice
                })
                .catch(e => Promise.reject(`Failed to execute ${JSON.stringify(order)} order. ${e}`));
            break;
        default:
            return Promise.reject(`Order type not recognized : ${order.type}`);
        }
        log.debug(`Created binance order : ${binanceOrder}`);
        order.externalId = binanceOrder.id;
        order.status = binanceOrder.status;
        order.datetime = binanceOrder.datetime;
        order.info = binanceOrder.info;
        order.filled = binanceOrder.filled;
        order.remaining = binanceOrder.remaining;
        order.average = binanceOrder.average;
        if (!awaitCompletion) {
            return Promise.resolve(order);
        }

        let filled = false;
        while (!filled) {
            await GlobalUtils.sleep(1);
            order = await this.getOrder(order.externalId!,
                `${order.targetAsset}/${order.originAsset}`, order.id)
                .catch(e => Promise.reject(e));
            filled = order.status === "closed";
        }
        return Promise.resolve(order);
    }

    public async getOrder(orderId: string, marketSymbol: string, internalOrderId: string) : Promise<Order> {
        const binanceOrder = await this.binance.fetchOrder(orderId, marketSymbol)
            .catch(e => Promise.reject(e));
        const order: Order = {
            id: internalOrderId,
            externalId: binanceOrder.id,
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
        // const market = await this.binance.fetchTicker("CHZ/BNB");
        const market = await this.binance.fetchTicker("BNB/EUR");
        // console.log(market);
        return {
            symbol: market.symbol,
            originAsset: Currency[market.symbol.split('/')[1] as keyof typeof Currency],
            targetAsset: market.symbol.split('/')[0],
            candleSticks: [
                [
                    1616435100000,
                    0.00000629,
                    0.00000645,
                    0.00000622,
                    0.00000635,
                    76627443
                ],
                [
                    1616436000000,
                    0.00000636,
                    0.00000636,
                    0.00000601,
                    0.00000607,
                    91004794
                ],
                [
                    1616436900000,
                    0.00000607,
                    0.00000625,
                    0.0000058,
                    0.00000583,
                    126546955
                ],
                [
                    1616437800000,
                    0.00000585,
                    0.00000587,
                    0.00000555,
                    0.00000577,
                    154234636
                ],
                [
                    1616438700000,
                    0.00000579,
                    0.00000596,
                    0.00000568,
                    0.00000571,
                    117033726
                ],
                [
                    1616439600000,
                    0.00000568,
                    0.00000579,
                    0.00000548,
                    0.00000553,
                    159815251
                ],
                [
                    1616440500000,
                    0.00000554,
                    0.00000592,
                    0.00000543,
                    0.00000578,
                    118020988
                ],
                [
                    1616441400000,
                    0.00000577,
                    0.00000596,
                    0.00000557,
                    0.00000595,
                    78211596
                ],
                [
                    1616442300000,
                    0.00000596,
                    0.00000654,
                    0.00000586,
                    0.00000622,
                    194289820
                ],
                [
                    1616443200000,
                    0.00000622,
                    0.00000643,
                    0.00000605,
                    0.00000629,
                    130423883
                ],
                [
                    1616444100000,
                    0.0000063,
                    0.00000638,
                    0.00000591,
                    0.00000604,
                    98955239
                ],
                [
                    1616445000000,
                    0.00000604,
                    0.00000615,
                    0.00000583,
                    0.00000586,
                    89996580
                ],
                [
                    1616445900000,
                    0.00000586,
                    0.00000613,
                    0.00000581,
                    0.00000605,
                    83811791
                ],
                [
                    1616446800000,
                    0.00000606,
                    0.0000063,
                    0.00000592,
                    0.00000626,
                    93667225
                ],
                [
                    1616447700000,
                    0.00000627,
                    0.0000063,
                    0.00000599,
                    0.00000603,
                    73110702
                ],
                [
                    1616448600000,
                    0.00000604,
                    0.00000614,
                    0.00000594,
                    0.00000598,
                    38004172
                ],
                [
                    1616449500000,
                    0.00000597,
                    0.00000599,
                    0.00000577,
                    0.00000591,
                    53143254
                ],
                [
                    1616450400000,
                    0.00000591,
                    0.00000593,
                    0.00000561,
                    0.00000592,
                    84973857
                ],
                [
                    1616451300000,
                    0.00000592,
                    0.00000593,
                    0.00000573,
                    0.0000058,
                    52504548
                ],
                [
                    1616452200000,
                    0.00000581,
                    0.00000625,
                    0.00000575,
                    0.00000606,
                    58605962
                ]
            ],
            candleSticksPercentageVariations: [
                0.9448818897637778,  -4.777594728171337,
                -4.116638078902227, -1.3864818024263457,
                -1.4010507880910552,  -2.712477396021697,
                4.152249134948079,   3.025210084033617,
                4.180064308681679,  1.1128775834658313,
                -4.3046357615894095, -3.0716723549488023,
                3.1404958677685926,  3.1948881789137573,
                -3.980099502487562,  -1.003344481605339,
                -1.015228426395936,  0.1689189189189051,
                -2.068965517241381,   4.125412541254121
            ]

        };
    }

}

