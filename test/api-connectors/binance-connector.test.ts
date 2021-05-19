import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestUtils } from "../test-utils";
import { GlobalUtils } from "../../src/utils/global-utils";

beforeAll(() => {
    jest.spyOn(GlobalUtils, 'sleep').mockImplementation(async() => Promise.resolve());
    process.env = Object.assign(process.env, { BINANCE_API_KEY: 'api key', BINANCE_API_SECRET: 'api secret' });

});

test("Should create binance instance with correct configuration", () => {
    // arrange
    const binanceConnector = new BinanceConnector();
    const binanceInstance = binanceConnector.getBinanceInstance();

    // assert
    expect(binanceInstance.verbose).toBe(false);
    expect(binanceInstance.enableRateLimit).toBe(false);
    expect(binanceInstance.apiKey).toBe('api key');
    expect(binanceInstance.secret).toBe('api secret');
});

describe("getMarketsBy24hrVariation", () => {
    const binanceConnector = new BinanceConnector();
    const binanceInstance = binanceConnector.getBinanceInstance();

    beforeAll(() => {
        binanceInstance.fetchTickers = jest.fn(async() => TestUtils.getBinanceFetchTickers());
    });

    test("Should correctly filter based on minimum percent for 24h change", async() => {
        // act
        const res = await binanceConnector.getMarketsBy24hrVariation(1);

        // assert
        expect(res).toEqual(TestUtils.getAllMarkets());
        expect(res).toHaveLength(TestUtils.getAllMarkets().length);
    });

    test("Should return unfiltered if the minimum percent is too low", async() => {
        // act
        const res = await binanceConnector.getMarketsBy24hrVariation(-Infinity);

        // assert
        expect(res).toHaveLength(Object.values(TestUtils.getBinanceFetchTickers()).length);
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
    const binanceConnector = new BinanceConnector();
    const binanceInstance = binanceConnector.getBinanceInstance();

    beforeAll(() => {
        binanceInstance.fetchOHLCV = jest.fn(async() => TestUtils.getBinanceFetchOHLCV());
    });

    test("Should call fetchOHLCV with correct arguments", async () => {
        // act
        await binanceConnector.getCandlesticks("OMG/BNB", "1m", 60, 3);

        // assert
        expect(binanceInstance.fetchOHLCV).toBeCalledWith("OMG/BNB", "1m", undefined, 60);
    });

    test("Should retry on failure", async () => {
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
