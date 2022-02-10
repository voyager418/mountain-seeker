import "reflect-metadata";
import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { TestHelper } from "../test-helper";
import { binance } from "ccxt";
import { ConfigService } from "../../src/services/config-service";
import { SqueezeIndicator } from "../../src/indicators/squeeze-indicator";
import { container } from "tsyringe";
const MACD = require('technicalindicators').MACD;
import hmacSHA256 from 'crypto-js/hmac-sha256';
import { Currency } from "../../src/enums/trading-currencies.enum";
import { Market, TOHLCVF } from "../../src//models/market";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { OrderType } from "../../src/enums/order-type.enum";
import { GlobalUtils } from "../../src/utils/global-utils";
import { ATR } from "technicalindicators";
import { StrategyUtils } from "../../src/utils/strategy-utils";
import { MACDIndicator } from "../../src/indicators/macd-indicator";
import { Account } from "../../src/models/account";


describe("Test things with Binance", () => {
    let binanceConnector: BinanceConnector;
    let configService: ConfigService;
    let binanceInstance: binance;
    let squeezeIndicator: SqueezeIndicator;
    const account: Account = {
        email: "",
        maxMoneyAmount: 1000,
        apiKey: 'api key',
        apiSecret: 'api secret',
        mailPreferences: {}
    }

    beforeAll(() => {
        configService = TestHelper.getMockedConfigService();
        configService.isSimulation = jest.fn(() => false);
        binanceConnector = new BinanceConnector(configService);
        binanceConnector.setup(account);
        binanceInstance = binanceConnector.getBinanceInstance();
        squeezeIndicator = container.resolve(SqueezeIndicator);
    });

    test("To test things with binance", async () => {
        // get candle sticks
        // const candleSticks = await binanceConnector.getCandlesticks("DREP/USDT",
        //     CandlestickInterval.FIFTEEN_MINUTES, 100, 2);

        // print market details
        // await binanceConnector.getMarketsBy24hrVariation(-15);
        // console.log(`${JSON.stringify(binanceConnector.getBinanceInstance().markets["BTCDOWN/USDT"], GlobalUtils.replacer, 4)}`);

        // get order
        // const order = await binanceConnector.getOrder("260287326", Currency.USDT, "BNBUP", "123", OrderType.MARKET);

        // make buy market order with price
        // const order = await binanceConnector.createMarketBuyOrder(Currency.USDT, "BNBUP", 40, true);
        // console.log(order);

        // make buy market order with amount
        // const order = await binanceConnector.createMarketOrder(Currency.USDT, "BTCUP", "buy", 63);
        // console.log(order);

        // get wallet balance
        // const balance = await binanceConnector.getBalanceForAsset("BNBDOWN");
        // console.log(balance);

        // redeem BLVT
        // const redeemOrder = await binanceConnector.redeemBlvt("ETHDOWN", 0.01923400, 2);
        // console.log(redeemOrder);

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

        // ATR indicator
        // console.log(ATR.calculate({
        //     low: candleSticks.map(candle => candle[3]),
        //     high: candleSticks.map(candle => candle[2]),
        //     close: candleSticks.map(candle => candle[4]),
        //     period: 7
        // }).reverse());

        // barssince crossover
        // const macdResult = new MACDIndicator().compute(candleSticks);
        // const barsSinceCrossover = StrategyUtils.barsSince(StrategyUtils.crossover,
        //     macdResult.result.map(res => res.MACD!), macdResult.result.map(res => res.signal!));
        // console.log(barsSinceCrossover);
    });


});

