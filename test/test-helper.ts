import { Market } from "../src/models/market";
import fs from 'fs';
import * as ccxt from "ccxt";

export class TestHelper {
    private static MARKETS_FILE_PATH = "/files/markets.json";
    private static BINANCE_FETCH_TICKERS_FILE_PATH = "/files/binance_fetch_tickers.json";
    private static BINANCE_FETCH_BNB_TICKER_FILE_PATH = "/files/binance_fetch_BNB_ticker.json";
    private static BINANCE_FETCH_OHLCV_FILE_PATH = "/files/binance_fetch_ohlcv.json";
    private static BINANCE_FETCH_BALANCE_FILE_PATH = "/files/binance_fetch_wallet_balance.json";
    private static CURRENT_DIRECTORY_PATH = __dirname;

    static getFirst10Markets(): Array<Market> {
        const markets = JSON.parse(fs.readFileSync(this.CURRENT_DIRECTORY_PATH + this.MARKETS_FILE_PATH,
            "utf8")) as Array<Market>;
        return markets.slice(0, 11);
    }

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
}