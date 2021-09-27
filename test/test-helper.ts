import { Market, TOHLCV } from "../src/models/market";
import * as fs from 'fs';
import * as ccxt from "ccxt";
import { CandlestickInterval } from "../src/enums/candlestick-interval.enum";
import { ConfigService } from "../src/services/config-service";
import createMockInstance from "jest-create-mock-instance";


export class TestHelper {
    private static MARKETS_FILE_PATH = "/files/markets.json";
    private static BINANCE_FETCH_TICKERS_FILE_PATH = "/files/binance_fetch_tickers.json";
    private static BINANCE_FETCH_BNB_TICKER_FILE_PATH = "/files/binance_fetch_BNB_ticker.json";
    private static BINANCE_FETCH_OHLCV_FILE_PATH = "/files/binance_fetch_ohlcv.json";
    private static BINANCE_FETCH_BALANCE_FILE_PATH = "/files/binance_fetch_wallet_balance.json";
    private static BINANCE_MARKET_BUY_ORDER_FILE_PATH = "/files/binance_ccxt_create_MARKET_BUY_order.json";
    private static DIRECT_BINANCE_MARKET_BUY_ORDER_FILE_PATH = "/files/binance_create_MARKET_BUY_order.json";
    private static CANDLESTICKS = "/files/ADAUP_USDT_30m_candlesticks.json";
    private static CANDLESTICKS_PERCENT_VARIATIONS = "/files/ADAUP_USDT_30m_candlesticks_percent_variations.json";
    private static CURRENT_DIRECTORY_PATH = __dirname;

    static getAllMarkets(): Array<Market> {
        return JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH +
            this.MARKETS_FILE_PATH, "utf8")) as Array<Market>;
    }

    static getBinanceFetchTickers(): ccxt.Dictionary<ccxt.Ticker> {
        return JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.BINANCE_FETCH_TICKERS_FILE_PATH,
            "utf8")) as ccxt.Dictionary<ccxt.Ticker>;
    }

    static getBinanceFetchTicker(): ccxt.Ticker {
        return JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.BINANCE_FETCH_BNB_TICKER_FILE_PATH,
            "utf8")) as ccxt.Ticker;
    }

    static getBinanceFetchOHLCV(): ccxt.OHLCV[] {
        return JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.BINANCE_FETCH_OHLCV_FILE_PATH,
            "utf8")) as ccxt.OHLCV[];
    }

    static getBinanceFetchBalance(): ccxt.Balances {
        return JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.BINANCE_FETCH_BALANCE_FILE_PATH,
            "utf8")) as ccxt.Balances;
    }

    static getBinanceCreateBuyMarketOrder(): ccxt.Order {
        return JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.BINANCE_MARKET_BUY_ORDER_FILE_PATH,
            "utf8")) as ccxt.Order;
    }

    static getDirectBinanceCreateBuyMarketOrder(): any {
        return JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.DIRECT_BINANCE_MARKET_BUY_ORDER_FILE_PATH,
            "utf8")) as ccxt.Order;
    }

    static getBinanceCreateSellStopLimitOrder(): ccxt.Order {
        let order = JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.BINANCE_MARKET_BUY_ORDER_FILE_PATH,
            "utf8")) as ccxt.Order;
        order = { ... order,
            side: "sell",
            type: "limit",
            info: {
                status: "FILLED",
                type: "STOP_LOSS_LIMIT",
                side: "SELL"
            }
        };
        return order;
    }

    static getMarketsWith30mCandleSticks(): Array<Market> {
        const markets = JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.MARKETS_FILE_PATH,
            "utf8")) as Array<Market>;
        const firstMarket = markets[0];

        const candleSticks = JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.CANDLESTICKS,
            "utf8")) as Array<TOHLCV>;
        const candleSticksPercentVariations = JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.CANDLESTICKS_PERCENT_VARIATIONS,
            "utf8")) as Array<number>;

        firstMarket.candleSticks = new Map().set(CandlestickInterval.THIRTY_MINUTES, candleSticks);
        firstMarket.candleSticksPercentageVariations = new Map().set(CandlestickInterval.THIRTY_MINUTES, candleSticksPercentVariations);

        const secondMarket = markets[1];
        secondMarket.candleSticks = new Map().set(CandlestickInterval.THIRTY_MINUTES, candleSticks);
        secondMarket.candleSticksPercentageVariations = new Map().set(CandlestickInterval.THIRTY_MINUTES, candleSticksPercentVariations);

        return [firstMarket, secondMarket];
    }

    static getMockedConfigService(): ConfigService {
        const configService = createMockInstance(ConfigService);
        configService.isTestEnvironment = jest.fn(() => true);
        return configService;
    }
}