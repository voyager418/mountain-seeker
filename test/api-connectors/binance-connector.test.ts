import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestHelper } from "../test-helper";
import { GlobalUtils } from "../../src/utils/global-utils";
import { Currency } from "../../src/enums/trading-currencies.enum";
import { binance } from "ccxt";


describe("Binance connector", () => {
    let binanceConnector: BinanceConnector;
    let binanceInstance: binance;

    beforeAll(() => {
        jest.spyOn(GlobalUtils, 'sleep').mockImplementation(async () => Promise.resolve());
        process.env = Object.assign(process.env, { BINANCE_API_KEY: 'api key', BINANCE_API_SECRET: 'api secret' });
        binanceConnector = new BinanceConnector();
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
            binanceInstance.fetchTickers = jest.fn(async () => TestHelper.getBinanceFetchTickers());
        });

        test("Should correctly filter based on minimum percent for 24h change", async () => {
            // act
            const res = await binanceConnector.getMarketsBy24hrVariation(1);

            // assert
            expect(res).toEqual(TestHelper.getAllMarkets());
            expect(res).toHaveLength(TestHelper.getAllMarkets().length);
        });

        test("Should return unfiltered if the minimum percent is too low", async () => {
            // act
            const res = await binanceConnector.getMarketsBy24hrVariation(-Infinity);

            // assert
            expect(res).toHaveLength(Object.values(TestHelper.getBinanceFetchTickers()).length);
        });

        test("Should retry several times on failure", async () => {
            // arrange
            binanceInstance.fetchTickers = jest.fn(async () => Promise.reject("Test error msg"));

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
            binanceInstance.fetchOHLCV = jest.fn(async () => TestHelper.getBinanceFetchOHLCV());
        });

        test("Should call fetchOHLCV with correct arguments", async () => {
            // act
            await binanceConnector.getCandlesticks("OMG/BNB", "1m", 60, 3);

            // assert
            expect(binanceInstance.fetchOHLCV).toBeCalledWith("OMG/BNB", "1m", undefined, 60);
        });

        test("Should retry on failure", async () => {
            // arrange
            binanceInstance.fetchOHLCV = jest.fn(async () => Promise.reject("Error msg"));

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
            binanceInstance.fetchBalance = jest.fn(async () => TestHelper.getBinanceFetchBalance());
        });

        test("Should correctly return wallet balance for all expected assets", async () => {
            // act
            const res = await binanceConnector.getBalance(["EUR", "BNB", "BTC", "ETH"]);

            // assert
            expect(res.size).toEqual(4);
            expect(res.get("EUR")).toEqual(35.65796714);
            expect(res.get("BTC")).toEqual(0.00000092);
            expect(res.get("BNB")).toEqual(0.00159473);
            expect(res.get("ETH")).toEqual(0);
        });

        test("Should correctly return wallet balance for a particular asset", async () => {
            // act
            const res = await binanceConnector.getBalanceForAsset("BNB");

            // assert
            expect(res).toEqual(0.00159473);
        });
    });

    describe("getUnitPrice", () => {
        beforeAll(() => {
            binanceInstance.fetchTicker = jest.fn(async () => TestHelper.getBinanceFetchTicker());
        });

        test("Should correctly return a unit price for an asset", async () => {
            // act
            const res = await binanceConnector.getUnitPrice(Currency.EUR, "BNB");

            // assert
            expect(binanceInstance.fetchTicker).toHaveBeenCalledWith("BNB/EUR");
            expect(res).toEqual(295.75);
        });

        test("Should reject if the last price is not found", async () => {
            // arrange
            binanceInstance.fetchTicker = jest.fn(async () => Promise.reject());

            try {
                // act
                await binanceConnector.getUnitPrice(Currency.EUR, "BNB");
            } catch (e) {
                // assert
                expect(binanceInstance.fetchTicker).toHaveBeenCalledWith("BNB/EUR");
                expect(e).toEqual("Last price of BNB/EUR was not found");
            }
        });
    });

});

