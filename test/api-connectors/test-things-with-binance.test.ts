import "reflect-metadata";
import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestHelper } from "../test-helper";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { binance } from "ccxt";
import { ConfigService } from "../../src/services/config-service";
const MACD = require('technicalindicators').MACD;


describe("Test with Binance", () => {
    let binanceConnector: BinanceConnector;
    let configService: ConfigService;
    let binanceInstance: binance;

    beforeAll(() => {
        process.env = Object.assign(process.env, { BINANCE_API_KEY: 'api key', BINANCE_API_SECRET: 'api secret' });
        configService = TestHelper.getMockedConfigService();
        configService.isSimulation = jest.fn(() => true);
        binanceConnector = new BinanceConnector(configService);
        binanceInstance = binanceConnector.getBinanceInstance();
    });

    xtest("To test things with binance", async () => {
        const candleSticks = await binanceConnector.getCandlesticks("BNB/EUR", CandlestickInterval.THIRTY_MINUTES,
            100, 2);

        console.log(MACD.calculate({
            values: candleSticks.map(candle => candle[4]),
            SimpleMAOscillator: false,
            SimpleMASignal: false,
            fastPeriod: 12,
            slowPeriod: 26,
            signalPeriod: 9
        }).reverse());


    });


});

