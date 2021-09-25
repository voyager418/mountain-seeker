import "reflect-metadata";
import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestHelper } from "../test-helper";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { binance } from "ccxt";
import { ConfigService } from "../../src/services/config-service";
import { Currency } from "../../src/enums/trading-currencies.enum";
import { SqueezeIndicator } from "../../src/indicators/squeeze-indicator";
import { container } from "tsyringe";

const MACD = require('technicalindicators').MACD;


describe("Test with Binance", () => {
    let binanceConnector: BinanceConnector;
    let configService: ConfigService;
    let binanceInstance: binance;
    let squeezeIndicator: SqueezeIndicator;

    beforeAll(() => {
        process.env = Object.assign(process.env, { BINANCE_API_KEY: 'api key', BINANCE_API_SECRET: 'api secret' });
        configService = TestHelper.getMockedConfigService();
        configService.isSimulation = jest.fn(() => false);
        binanceConnector = new BinanceConnector(configService);
        binanceInstance = binanceConnector.getBinanceInstance();
        squeezeIndicator = container.resolve(SqueezeIndicator);
    });

    xtest("To test things with binance", async () => {
        const candleSticks = await binanceConnector.getCandlesticks("BTC/EUR", CandlestickInterval.ONE_HOUR,
            100, 2);


        // const order = await binanceConnector.createMarketBuyOrder(Currency.EUR, "BTC", 20,
        //     true, 5);

        const order = await binanceConnector.createLimitSellOrder(Currency.EUR, "BNB", 0.06667265,
            290, 5);
        console.log(order);


        // const res = squeezeIndicator.compute(candleSticks);
        // console.log(res);


        // console.log(binanceConnector.getBinanceInstance().markets["BTC/EUR"].info.filters);

        // await binanceConnector.createMarketOrder(Currency.EUR, "BNB", "sell",
        //     0.05354143, true);
        // console.log(MACD.calculate({
        //     values: candleSticks.map(candle => candle[4]),
        //     SimpleMAOscillator: false,
        //     SimpleMASignal: false,
        //     fastPeriod: 12,
        //     slowPeriod: 26,
        //     signalPeriod: 9
        // }).reverse());

        //await binanceConnector.createNewMarketOrder();
        // binanceInstance.options.createMarketBuyOrderRequiresPrice;
    });


});

