import "reflect-metadata";
import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestHelper } from "../test-helper";
import { binance } from "ccxt";
import { ConfigService } from "../../src/services/config-service";
import { SqueezeIndicator } from "../../src/indicators/squeeze-indicator";
import { container } from "tsyringe";
const MACD = require('technicalindicators').MACD;
import { Currency } from "../../src/enums/trading-currencies.enum";
import { Market, TOHLCV } from "../../src//models/market";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { OrderType } from "../../src/enums/order-type.enum";
import { GlobalUtils } from "../../src/utils/global-utils";


describe("Test things with Binance", () => {
    let binanceConnector: BinanceConnector;
    let configService: ConfigService;
    let binanceInstance: binance;
    let squeezeIndicator: SqueezeIndicator;

    beforeAll(() => {
        // comment the next line to use real environment variables
        process.env = Object.assign(process.env, { BINANCE_API_KEY: 'api key', BINANCE_API_SECRET: 'api secret' });
        configService = TestHelper.getMockedConfigService();
        configService.isSimulation = jest.fn(() => false);
        binanceConnector = new BinanceConnector(configService);
        binanceInstance = binanceConnector.getBinanceInstance();
        squeezeIndicator = container.resolve(SqueezeIndicator);
    });

    xtest("To test things with binance", async () => {
        // get candle sticks
        // const candleSticks = await binanceConnector.getCandlesticks("BTCDOWN/USDT", CandlestickInterval.ONE_HOUR,
        //     100, 2);

        // print market details
        //await binanceConnector.getMarketsBy24hrVariation(-15);
        //console.log(`${JSON.stringify(binanceConnector.getBinanceInstance().markets["BTCDOWN/USDT"], GlobalUtils.replacer, 4)}`);

        // get order
        // const order = await binanceConnector.getOrder("260287326", Currency.USDT, "BNBUP", "123", OrderType.MARKET);

        // make buy market order with price
        // const order = await binanceConnector.createMarketBuyOrder(Currency.USDT, "BNBUP", 40, true);
        // console.log(order);

        // make buy market order with amount
        // const order = await binanceConnector.createMarketOrder(Currency.USDT, "BTCUP", "buy", 63);
        // console.log(order);

        // squeeze indicator
        // const res = squeezeIndicator.compute(candleSticks);
        // console.log(res);

        // MACD indicator
        // console.log(MACD.calculate({
        //     values: candleSticks.map(candle => candle[4]),
        //     SimpleMAOscillator: false,
        //     SimpleMASignal: false,
        //     fastPeriod: 12,
        //     slowPeriod: 26,
        //     signalPeriod: 9
        // }).reverse());
    });


});

