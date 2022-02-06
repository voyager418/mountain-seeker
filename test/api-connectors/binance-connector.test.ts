import "reflect-metadata";
import axios from "axios";
import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestHelper } from "../test-helper";
import { GlobalUtils } from "../../src/utils/global-utils";
import { Currency } from "../../src/enums/trading-currencies.enum";
import { binance } from "ccxt";
import { ConfigService } from "../../src/services/config-service";
import * as mockdate from "mockdate";
import { OrderType } from "../../src/enums/order-type.enum";
import { Account } from "../../src/models/account";
import { fail } from "assert";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;


describe("Binance connector", () => {
    let binanceConnector: BinanceConnector;
    let configService: ConfigService;
    let binanceInstance: binance;
    const account: Account = {
        email: "",
        maxMoneyAmount: 1000,
        apiKey: 'api key',
        apiSecret: 'api secret',
        mailPreferences: {}
    }

    beforeAll(() => {
        jest.spyOn(GlobalUtils, 'sleep').mockImplementation(() => Promise.resolve());
        configService = TestHelper.getMockedConfigService();
        configService.isSimulation = jest.fn(() => false);

        binanceConnector = new BinanceConnector(configService);
        binanceConnector.setup(account)
        binanceInstance = binanceConnector.getBinanceInstance();
    });

    test("Should create binance instance with correct configuration", () => {
        // assert
        expect(binanceInstance.verbose).toBe(false);
        expect(binanceInstance.enableRateLimit).toBe(false);
        expect(binanceInstance.apiKey).toBe('api key');
        expect(binanceInstance.secret).toBe('api secret');
    });

    describe("getMarketsBy24hrVariation", () => {
        beforeAll(() => {
            binanceInstance.fetchTickers = jest.fn(async() => TestHelper.getBinanceFetchTickers());
        });

        test("Should correctly filter based on minimum percent for 24h change", async() => {
            // act
            const res = await binanceConnector.getMarketsBy24hrVariation(1);

            // assert
            expect(res).toHaveLength(TestHelper.getAllMarkets().length);
        });

        test("Should return unfiltered if the minimum percent is too low", async() => {
            // act
            const res = await binanceConnector.getMarketsBy24hrVariation(-Infinity);

            // assert
            expect(res).toHaveLength(Object.values(TestHelper.getBinanceFetchTickers()).length);
        });

        test("Should retry several times on failure", async() => {
            // arrange
            binanceInstance.fetchTickers = jest.fn(async() => Promise.reject("Test error msg"));

            // act
            try {
                await binanceConnector.getMarketsBy24hrVariation(2);
                fail("Should throw an error");
            } catch (e) {
                // assert
                expect(e).toBe("Failed to fetch tickers. Test error msg");
                expect(binanceInstance.fetchTickers).toHaveBeenCalledTimes(31);
            }
        });
    });

    describe("getCandlesticks", () => {
        beforeAll(() => {
            binanceInstance.fetchOHLCV = jest.fn(async() => TestHelper.getBinanceFetchOHLCV());
        });

        test("Should call fetchOHLCV with correct arguments", async() => {
            // act
            await binanceConnector.getCandlesticks("OMG/BNB", "1m", 60, 3);

            // assert
            expect(binanceInstance.fetchOHLCV).toBeCalledWith("OMG/BNB", "1m", undefined, 60);
        });

        test("Should retry on failure", async() => {
            // arrange
            binanceInstance.fetchOHLCV = jest.fn(async() => Promise.reject("Error msg"));

            // act
            try {
                await binanceConnector.getCandlesticks("OMG/BNB", "1m", 60, 3);
                fail("Should throw an error");
            } catch (e) {
                // assert
                expect(e).toBe("Failed to fetch candle sticks.");
                expect(binanceInstance.fetchOHLCV).toHaveBeenCalledTimes(4);
            }
        });
    });

    describe("getBalance & getBalanceForAsset", () => {
        test("Should correctly return wallet balance for all expected assets", async() => {
            // arrange
            binanceInstance.fetchBalance = jest.fn(async() => TestHelper.getBinanceFetchBalance());

            // act
            const res = await binanceConnector.getBalance(["EUR", "BNB", "BTC", "ETH"], 1);

            // assert
            expect(res.size).toEqual(4);
            expect(res.get("EUR")).toEqual(35.65796714);
            expect(res.get("BTC")).toEqual(0.00000092);
            expect(res.get("BNB")).toEqual(0.00159473);
            expect(res.get("ETH")).toEqual(0);
        });

        test("Should retry when can not get wallet balance", async() => {
            // arrange
            binanceInstance.fetchBalance = jest.fn(async() => Promise.reject(undefined));

            // act
            try {
                await binanceConnector.getBalance(["EUR", "BNB", "BTC", "ETH"], 3);
                fail("Should throw an exception");
            } catch (e) {
                expect(binanceInstance.fetchBalance).toHaveBeenCalledTimes(4);
                expect(e).toEqual("Failed to fetch wallet balance for [\"EUR\",\"BNB\",\"BTC\",\"ETH\"] after 3 retries");
            }
        });

        test("Should correctly return wallet balance for a particular asset", async() => {
            // arrange
            binanceInstance.fetchBalance = jest.fn(async() => TestHelper.getBinanceFetchBalance());

            // act
            const res = await binanceConnector.getBalanceForAsset("BNB", 3);

            // assert
            expect(res).toEqual(0.00159473);
        });

        test("Should retry when can not get wallet balance for a particular asset", async() => {
            // arrange
            binanceInstance.fetchBalance = jest.fn(async() => Promise.reject(undefined));

            // act
            try {
                await binanceConnector.getBalanceForAsset("BNB", 3);
                fail("Should throw an exception");
            } catch (e) {
                expect(binanceInstance.fetchBalance).toHaveBeenCalledTimes(4);
                expect(e).toEqual("Failed to fetch balance for currency BNB");
            }
        });
    });

    describe("getUnitPrice", () => {
        beforeAll(() => {
            binanceInstance.fetchTicker = jest.fn(async() => TestHelper.getBinanceFetchTicker());
        });

        test("Should correctly return a unit price for an asset", async() => {
            // act
            const res = await binanceConnector.getUnitPrice(Currency.EUR, "BNB", true, 1);

            // assert
            expect(binanceInstance.fetchTicker).toHaveBeenCalledWith("BNB/EUR");
            expect(res).toEqual(295.75);
        });

        test("Should reject if the last price not found", async() => {
            // arrange
            binanceInstance.fetchTicker = jest.fn(async() => Promise.reject());

            try {
                // act
                await binanceConnector.getUnitPrice(Currency.EUR, "BNB", true, 1);
                fail("Should reject");
            } catch (e) {
                // assert
                expect(binanceInstance.fetchTicker).toHaveBeenCalledWith("BNB/EUR");
                expect(e).toEqual("Last price of BNB/EUR was not found");
            }
        });
    });

    describe("createMarketOrder", () => {
        beforeAll(() => {
            binanceInstance.createOrder = jest.fn(async () => TestHelper.getBinanceCreateBuyMarketOrder());
        });

        test("Should not call binance API if it is a simulation", async() => {
            // arrange
            configService.isSimulation = jest.fn(() => true);
            binanceConnector.getUnitPrice = jest.fn(async () => 5);

            // act
            const res = await binanceConnector.createMarketOrder(Currency.EUR, "BNB", "buy", 10, true,
                undefined, 2);

            // assert
            expect(binanceInstance.createOrder).not.toHaveBeenCalled();
            expect(res).toBeDefined();
            configService.isSimulation = jest.fn(() => false);
        });

        test("Should correctly create a MARKET BUY order", async() => {
            // arrange
            const waitForOrderCompletionSpy = jest.spyOn(binanceConnector, 'waitForOrderCompletion');

            // act
            const res = await binanceConnector.createMarketOrder(Currency.EUR, "BNB", "buy", 10.123456789, true);

            // assert
            expect(binanceInstance.createOrder).toHaveBeenCalled();
            expect(waitForOrderCompletionSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    externalId: "234063358",
                    status: "closed"
                }),
                Currency.EUR,
                "BNB",
                3
            );
            expect(res).toMatchObject({
                side: "buy",
                externalId: "234063358",
                amountOfTargetAsset: 10.12345678,
                amountOfOriginAsset: 11.971475,
                filled: 0.03887082,
                remaining: 0,
                average: 307.75,
                status: "closed",
                originAsset: "EUR",
                targetAsset: "BNB",
                type: "MARKET",
                datetime: "2021-05-27T13:39:24.641Z",
                info : {
                    fills: [
                        {
                            "price": "307.75000000",
                            "qty": "0.03890000",
                            "commission": "0.00002917",
                            "commissionAsset": "BNB",
                            "tradeId": 14693522
                        }
                    ]
                }
            });
        });

        test("Should retry and recalculate the amount to buy when order creation fails and retries are set", async() => {
            // arrange
            binanceConnector.getUnitPrice = jest.fn(() => Promise.resolve(310));
            binanceInstance.createOrder = jest.fn(async () => Promise.reject());

            try {
                // act
                await binanceConnector.createMarketOrder(Currency.EUR, "BNB", "buy",
                    0.0389, false, 5, 12);
                fail("Should reject");
            } catch (e) {
                // assert
                expect(e).toEqual("Failed to execute buy market order on market BNB/EUR");
                expect(binanceConnector.getUnitPrice).toHaveBeenCalledTimes(5);
                expect(binanceInstance.createOrder).toHaveBeenCalledTimes(6);
                expect(binanceInstance.createOrder).toHaveBeenNthCalledWith(1, "BNB/EUR", "market", "buy", 0.0389);
                expect(binanceInstance.createOrder).toHaveBeenNthCalledWith(2, "BNB/EUR", "market", "buy", 0.03855483);
                expect(binanceInstance.createOrder).toHaveBeenNthCalledWith(3, "BNB/EUR", "market", "buy", 0.0384);
            }
        });
    });

    describe("createMarketBuyOrder", () => {
        beforeAll(() => {
            binanceInstance.createMarketBuyOrder = jest.fn(async () => TestHelper.getBinanceCreateBuyMarketOrder());
        });

        test("Should not call binance API if it is a simulation", async() => {
            // arrange
            configService.isSimulation = jest.fn(() => true);
            binanceConnector.getUnitPrice = jest.fn(async () => 5);

            // act
            const res = await binanceConnector.createMarketBuyOrder(Currency.EUR, "BNB", 12, true);

            // assert
            expect(binanceInstance.createMarketBuyOrder).not.toHaveBeenCalled();
            expect(res).toBeDefined();
            configService.isSimulation = jest.fn(() => false);
        });

        test("Should correctly create a MARKET BUY order", async() => {
            // arrange
            const waitForOrderCompletionSpy = jest.spyOn(binanceConnector, 'waitForOrderCompletion');
            mockedAxios.post.mockResolvedValueOnce(TestHelper.getDirectBinanceCreateBuyMarketOrder());

            // act
            const res = await binanceConnector.createMarketBuyOrder(Currency.EUR, "BTC", 20, true);

            // assert
            expect(waitForOrderCompletionSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    externalId: "1199969870",
                    status: "closed"
                }),
                Currency.EUR.toString(),
                "BTC",
                3
            );
            expect(res).toMatchObject({
                side: "buy",
                externalId: "1199969870",
                amountOfTargetAsset: 0.00053,
                amountOfOriginAsset: 19.662287,
                filled: 0.00053,
                remaining: 0,
                average: 37098.65471698,
                status: "closed",
                originAsset: "EUR",
                targetAsset: "BTC",
                type: "MARKET",
                datetime: "2021-09-26T12:42:12.185Z",
                info : {
                    fills: [
                        {
                            "price": "37095.78000000",
                            "qty": "0.00001000",
                            "commission": "0.00000094",
                            "commissionAsset": "BNB",
                            "tradeId": 64708797
                        },
                        {
                            "price": "37098.71000000",
                            "qty": "0.00052000",
                            "commission": "0.00004948",
                            "commissionAsset": "BNB",
                            "tradeId": 64708798
                        }
                    ]
                }
            });
        });

        test("Should retry when order creation fails and retries are set", async() => {
            // arrange
            mockdate.set(new Date('14 Sep 2020 00:00:00'));
            binanceConnector.getUnitPrice = jest.fn(() => Promise.resolve(310));
            mockedAxios.post.mockResolvedValueOnce(undefined);

            try {
                // act
                await binanceConnector.createMarketBuyOrder(Currency.EUR, "BNB", 25, false, 5);
                fail("Should reject");
            } catch (e) {
                // assert
                expect(e).toEqual("Failed to execute buy market order on market BNB/EUR");
                expect(axios.post).toHaveBeenCalledWith(
                    "https://api.binance.com/api/v3/order?symbol=BNBEUR&side=BUY&type=MARKET&quoteOrderQty=25&timestamp=1600034400000&signature=d4bbfa7c90879b92174976b266fc183413c3bb4923a4d285a8f24f5a7acd2878",
                    undefined,
                    { "headers": { "Content-Type": "application/json", "X-MBX-APIKEY": account.apiKey } }
                );
                expect(axios.post).toHaveBeenCalledTimes(6);
            }
            mockdate.reset();
        });
    });

    describe("createStopLimitOrder", () => {
        beforeAll(() => {
            binanceInstance.createOrder = jest.fn(async () => TestHelper.getBinanceCreateSellStopLimitOrder());
        });

        test("Should not call binance API if it is a simulation", async() => {
            // arrange
            configService.isSimulation = jest.fn(() => true);

            // act
            const res = await binanceConnector.createStopLimitOrder(Currency.EUR, "BNB", "sell",
                10, 390, 390);

            // assert
            expect(binanceInstance.createOrder).not.toHaveBeenCalled();
            expect(res).toBeDefined();
            configService.isSimulation = jest.fn(() => false);
        });

        test("Should correctly create a STOP_LIMIT SELL order", async() => {
            // act
            const res = await binanceConnector.createStopLimitOrder(Currency.EUR, "BNB", "sell",
                10, 390, 390);

            // assert
            expect(binanceInstance.createOrder).toHaveBeenCalledWith("BNB/EUR", "STOP_LOSS_LIMIT",
                "sell", 10, 390, { stopPrice: 390 });
            expect(res).toMatchObject({
                side: "sell",
                externalId: "234063358",
                amountOfTargetAsset: 10,
                amountOfOriginAsset: 11.95950353,
                filled: 0.0389,
                remaining: 0,
                average: 307.75,
                status: "closed",
                originAsset: "EUR",
                targetAsset: "BNB",
                type: "STOP_LIMIT",
                datetime: "2021-05-27T13:39:24.641Z",
                info : {
                    status: "FILLED",
                    type: "STOP_LOSS_LIMIT",
                    side: "SELL"
                }
            });
        });

        test("Should retry if order creation failed and retries are enabled", async() => {
            // arrange
            binanceInstance.createOrder = jest.fn(async () => Promise.reject(new Error("api error")));

            try {
                // act
                await binanceConnector.createStopLimitOrder(Currency.EUR, "BNB", "sell",
                    10, 390, 390, 3);
                fail("Should reject");
            } catch (e) {
                // assert
                expect(e).toEqual("Failed to execute sell stop limit order of 10 on market BNB/EUR");
                expect(binanceInstance.createOrder).toHaveBeenCalledTimes(4);
            }
        });
    });

    describe("getOrder", () => {
        test("Should correctly return an order", async() => {
            // arrange
            binanceInstance.fetchOrder = jest.fn(async() => Promise.resolve(TestHelper.fetchOrder()));

            // act
            const order = await binanceConnector.getOrder("1217145293", Currency.EUR,
                "BTC", "123", OrderType.STOP_LIMIT);

            // assert
            expect(binanceInstance.fetchOrder).toHaveBeenCalledWith("1217145293", "BTC/EUR");
            expect(order).toEqual({
                type: "STOP_LIMIT",
                id: "123",
                externalId: "1217145293",
                side: "sell",
                amountOfTargetAsset: 0.00085,
                filled: 0.00085,
                remaining: 0,
                average: 40727.25,
                amountOfOriginAsset: 34.583544339999996,
                status: "closed",
                datetime: "2021-10-01T12:44:24.935Z",
                info: {
                    symbol: "BTCEUR",
                    orderId: "1217145293",
                    orderListId: "-1",
                    clientOrderId: "x-R4BD3S82bb809fd68e67455aa44798",
                    price: "40727.25000000",
                    origQty: "0.00085000",
                    executedQty: "0.00085000",
                    cummulativeQuoteQty: "34.61816250",
                    status: "FILLED",
                    timeInForce: "GTC",
                    type: "STOP_LOSS_LIMIT",
                    side: "SELL",
                    stopPrice: "40727.25000000",
                    icebergQty: "0.00000000",
                    time: "1633085064935",
                    updateTime: "1633085234864",
                    isWorking: true,
                    origQuoteOrderQty: "0.00000000"
                },
                originAsset: "EUR",
                targetAsset: "BTC"
            });
        });

        test("Should retry several times when failing to fetch an order", async() => {
            // arrange
            binanceInstance.fetchOrder = jest.fn(async() => Promise.reject(undefined));

            // act
            try {
                await binanceConnector.getOrder("1217145293", Currency.EUR, "BTC", "123", OrderType.STOP_LIMIT, 3);
                fail("Should throw an exception");
            } catch (e) {
                expect(binanceInstance.fetchOrder).toHaveBeenCalledTimes(4);
                expect(e).toEqual("Order 1217145293 was not found")
            }
        });
    });

    describe("cancelOrder", () => {
        test("Should correctly cancel an order and not call getOrder() if it already canceled", async() => {
            // arrange
            const binanceCanceledOder = TestHelper.getBinanceCreateSellStopLimitOrder();
            binanceCanceledOder.status = "canceled";
            binanceInstance.cancelOrder = jest.fn(async() => Promise.resolve(binanceCanceledOder));
            binanceInstance.fetchOrder = jest.fn(async() => Promise.resolve(binanceCanceledOder));
            binanceConnector.getOrder = jest.fn(async() => Promise.resolve(TestHelper.getMockedOrder()));

            // act
            await binanceConnector.cancelOrder("1217145293", "123", Currency.EUR, "BTC", 3);

            // assert
            expect(binanceInstance.cancelOrder).toHaveBeenCalledWith("1217145293", "BTC/EUR");
            expect(binanceConnector.getOrder).not.toHaveBeenCalled();
        });

        test("Should retry to call the cancel operation to cancel an order", async() => {
            // arrange
            const binanceOpenOrder = TestHelper.getBinanceCreateSellStopLimitOrder();
            binanceOpenOrder.status = "open";
            const ourOpenOrder = TestHelper.getMockedOrder();
            ourOpenOrder.status = "open";
            binanceInstance.cancelOrder = jest.fn(async() => Promise.reject(undefined));
            binanceInstance.fetchOrder = jest.fn(async() => Promise.resolve(binanceOpenOrder));
            binanceConnector.getOrder = jest.fn(async() => Promise.resolve(ourOpenOrder));

            try {
                // act
                await binanceConnector.cancelOrder("1217145293", "123", Currency.EUR, "BTC", 3);
                fail("Should throw an exception");
            } catch (e) {
                // assert
                expect(binanceInstance.cancelOrder).toHaveBeenCalledWith("1217145293", "BTC/EUR");
                expect(binanceInstance.cancelOrder).toHaveBeenCalledTimes(4);
                expect(binanceConnector.getOrder).toHaveBeenCalledTimes(4);
                expect(e).toEqual(`Failed to cancel order 1217145293`);
            }
        });

        test("Should retry to cancel an order", async() => {
            // arrange
            const binanceOpenOrder = TestHelper.getBinanceCreateSellStopLimitOrder();
            binanceOpenOrder.status = "open";
            const ourOpenOrder = TestHelper.getMockedOrder();
            ourOpenOrder.status = "open";
            binanceInstance.cancelOrder = jest.fn(async() => Promise.resolve(binanceOpenOrder));
            binanceInstance.fetchOrder = jest.fn(async() => Promise.resolve(binanceOpenOrder));
            binanceConnector.getOrder = jest.fn(async() => Promise.resolve(ourOpenOrder));

            // act
            try {
                await binanceConnector.cancelOrder("1217145293", "123", Currency.EUR, "BTC", 3);
            } catch (e) {
                // assert
                expect(binanceInstance.cancelOrder).toHaveBeenCalledWith("1217145293", "BTC/EUR");
                expect(binanceInstance.cancelOrder).toHaveBeenCalledTimes(1);
                expect(binanceConnector.getOrder).toHaveBeenCalledTimes(4);
                expect(e).toEqual(`Failed to cancel order : ${JSON.stringify(ourOpenOrder)}`);
            }

        });
    });

    describe("waitForOrderCompletion", () => {
        test("Should not wait if an order is already completed", async() => {
            // arrange
            const completedOrder = TestHelper.getMockedOrder();
            completedOrder.status = "closed";
            binanceConnector.getOrder = jest.fn(async() => Promise.resolve(completedOrder));

            // act
            const result = await binanceConnector.waitForOrderCompletion(completedOrder, completedOrder.originAsset, completedOrder.targetAsset, 3);

            // assert
            expect(result).toEqual(completedOrder);
            expect(binanceConnector.getOrder).not.toHaveBeenCalled();
        });

        test("Should retry and wait if an order is not completed", async() => {
            // arrange
            const openOrder = TestHelper.getMockedOrder();
            openOrder.status = "open";
            binanceConnector.getOrder = jest.fn(async() => Promise.resolve(openOrder));

            // act
            const result = await binanceConnector.waitForOrderCompletion(openOrder, openOrder.originAsset, openOrder.targetAsset, 3);

            // assert
            expect(binanceConnector.getOrder).toHaveBeenCalledTimes(4);
            expect(result).toBeUndefined();
        });
    });

    describe("orderIsclosed", () => {
        test("Should return true if order is already closed", async() => {
            // arrange
            const completedOrder = TestHelper.getMockedOrder();
            completedOrder.status = "closed";
            binanceConnector.getOrder = jest.fn(async() => Promise.resolve(completedOrder));

            // act
            const result = await binanceConnector.orderIsClosed(completedOrder.externalId, completedOrder.originAsset, completedOrder.targetAsset,
                completedOrder.id, completedOrder.type!);

            // assert
            expect(result).toBeTruthy();
        });

        test("Should retry to fetch an oder while verifying if that order is closed", async() => {
            // arrange
            const completedOrder = TestHelper.getMockedOrder();
            completedOrder.status = "closed";
            binanceInstance.fetchOrder = jest.fn(async() => Promise.reject(undefined));

            try {
                // act
                await binanceConnector.orderIsClosed(completedOrder.externalId, completedOrder.originAsset, completedOrder.targetAsset,
                    completedOrder.id, completedOrder.type!, 3);
            } catch (e) {
                // assert
                expect(e).toEqual(`Order ${completedOrder.externalId} was not found`)
                expect(binanceInstance.fetchOrder).toHaveBeenCalledTimes(4);
            }

        });
    });

    describe("redeemBlvt", () => {
        test("Should correctly return after redeeming BLVT order", async() => {
            // arrange
            const redeemOrder = TestHelper.getMockedRedeemOrder();
            mockedAxios.post.mockResolvedValueOnce({
                status: 200,
                data: {
                    id: 123,
                    status: "S", // S, P, and F for "success", "pending", and "failure"
                    tokenName: "LINKUP",
                    redeemAmount: "0.95590905",       // Redemption token amount
                    amount: "10.05022099",    // Redemption value in usdt
                    timestamp: 1600250279614
                }
            });


            // act
            const result = await binanceConnector.redeemBlvt(redeemOrder.targetAsset, redeemOrder.amount, 3);

            // assert
            expect(result).toEqual(redeemOrder);
        });

        test("Should retry to redeem BLVT order", async() => {
            // arrange
            const redeemOrder = TestHelper.getMockedRedeemOrder();
            mockedAxios.post.mockResolvedValueOnce({
                status: 500
            });

            try {
                // act
                await binanceConnector.redeemBlvt(redeemOrder.targetAsset, redeemOrder.amount, 3);
            } catch (e) {
                expect(e).toBeUndefined();
                expect(mockedAxios.post).toHaveBeenCalledTimes(4);
            }
        });
    });
});

