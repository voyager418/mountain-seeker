import "reflect-metadata";
import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestHelper } from "../test-helper";
import { GlobalUtils } from "../../src/utils/global-utils";
import { Currency } from "../../src/enums/trading-currencies.enum";
import { binance } from "ccxt";
import { ConfigService } from "../../src/services/config-service";
import createMockInstance from "jest-create-mock-instance";


describe("Binance connector", () => {
    let binanceConnector: BinanceConnector;
    let configService: ConfigService;
    let binanceInstance: binance;

    beforeAll(() => {
        jest.spyOn(GlobalUtils, 'sleep').mockImplementation(async() => Promise.resolve());
        process.env = Object.assign(process.env, { BINANCE_API_KEY: 'api key', BINANCE_API_SECRET: 'api secret' });
        configService = createMockInstance(ConfigService);
        configService.isSimulation = jest.fn(() => false);

        binanceConnector = new BinanceConnector(configService);
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
            expect(res).toEqual(TestHelper.getAllMarkets());
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
                expect(binanceInstance.fetchTickers).toHaveBeenCalledTimes(4);
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
        beforeAll(() => {
            binanceInstance.fetchBalance = jest.fn(async() => TestHelper.getBinanceFetchBalance());
        });

        test("Should correctly return wallet balance for all expected assets", async() => {
            // act
            const res = await binanceConnector.getBalance(["EUR", "BNB", "BTC", "ETH"]);

            // assert
            expect(res.size).toEqual(4);
            expect(res.get("EUR")).toEqual(35.65796714);
            expect(res.get("BTC")).toEqual(0.00000092);
            expect(res.get("BNB")).toEqual(0.00159473);
            expect(res.get("ETH")).toEqual(0);
        });

        test("Should correctly return wallet balance for a particular asset", async() => {
            // act
            const res = await binanceConnector.getBalanceForAsset("BNB");

            // assert
            expect(res).toEqual(0.00159473);
        });
    });

    describe("getUnitPrice", () => {
        beforeAll(() => {
            binanceInstance.fetchTicker = jest.fn(async() => TestHelper.getBinanceFetchTicker());
        });

        test("Should correctly return a unit price for an asset", async() => {
            // act
            const res = await binanceConnector.getUnitPrice(Currency.EUR, "BNB");

            // assert
            expect(binanceInstance.fetchTicker).toHaveBeenCalledWith("BNB/EUR");
            expect(res).toEqual(295.75);
        });

        test("Should reject if the last price not found", async() => {
            // arrange
            binanceInstance.fetchTicker = jest.fn(async() => Promise.reject());

            try {
                // act
                await binanceConnector.getUnitPrice(Currency.EUR, "BNB");
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

            // act
            const res = await binanceConnector.createMarketOrder(Currency.EUR, "BNB", "buy", 10, true);

            // assert
            expect(binanceInstance.createOrder).not.toHaveBeenCalled();
            expect(res).toBeDefined();
            configService.isSimulation = jest.fn(() => false);
        });

        test("Should correctly create a MARKET BUY order", async() => {
            // arrange
            const waitForOrderCompletionSpy = jest.spyOn(binanceConnector, 'waitForOrderCompletion');

            // act
            const res = await binanceConnector.createMarketOrder(Currency.EUR, "BNB", "buy", 10, true);

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
                amountOfTargetAsset: 10,
                amountOfOriginAsset: 11.971475,
                filled: 0.038870829999999995,
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
                expect(binanceInstance.createOrder).toHaveBeenNthCalledWith(2, "BNB/EUR", "market", "buy", 0.03870967741935484);
            }
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
                amountOfOriginAsset: 11.971475,
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

});

