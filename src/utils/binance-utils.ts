import { MarketOrderFill } from "../api-connectors/binance-connector";
import hmacSHA256 from 'crypto-js/hmac-sha256';
import { Market } from "../models/market";
import ccxt from "ccxt";
import { NumberUtils } from "./number-utils";

/**
 * Helper class for Binance API connector
 */
export class BinanceUtils {

    /**
     * Constructs a URL from a base path and query arguments that includes a signature and a timestamp
     * needed to call private Binance endpoints (like buy order)
     * @param secret Binance API secret
     */
    static generateURL(urlBasePath: string, query: string, secret: string): string {
        const queryString = `${query}&timestamp=${Date.now()}`;
        const urlPath = `${urlBasePath}?${queryString}`;
        const signature = hmacSHA256(queryString, secret).toString();
        return `${urlPath}&signature=${signature}`;
    }

    /**
     * Sets the {@link Market.minNotional} field
     */
    static setMarketMinNotional(market: Market, markets: ccxt.Dictionary<ccxt.Market>): void {
        const minNotionalFilter = markets[market.symbol].info.filters
            .filter((filter: { filterType: string; }) => filter.filterType === "MIN_NOTIONAL")[0];
        if (minNotionalFilter) {
            market.minNotional = Number(minNotionalFilter.minNotional);
        }
    }

    /**
     * Sets the {@link Market.amountPrecision} field
     */
    static setMarketAmountPrecision(market: Market, markets: ccxt.Dictionary<ccxt.Market>): void {
        const amountPrecision = markets[market.symbol]?.precision?.amount;
        if (amountPrecision && amountPrecision >= 0) {
            market.amountPrecision = amountPrecision;
        }
    }

    /**
     * Sets the {@link Market.pricePrecision} field
     */
    static setPricePrecision(market: Market, markets: ccxt.Dictionary<ccxt.Market>): void {
        const pricePrecision = markets[market.symbol]?.precision?.price;
        if (pricePrecision && pricePrecision >= 0) {
            market.pricePrecision = pricePrecision;
        }
    }

    /**
     * Sets the {@link Market.maxPosition} field
     */
    static setMaxPosition(market: Market, markets: ccxt.Dictionary<ccxt.Market>): void {
        const maxPositionFilter = markets[market.symbol]?.info.filters
            .filter((element: { filterType: string; }) => element.filterType === "MAX_POSITION")[0];
        if (maxPositionFilter) {
            market.maxPosition = Number(maxPositionFilter.maxPosition);
        } else {
            market.maxPosition = Infinity;
        }
    }

    /**
     * Sets the {@link Market.quoteOrderQtyMarketAllowed} field
     */
    static setQuoteOrderQtyMarketAllowed(market: Market, markets: ccxt.Dictionary<ccxt.Market>): void {
        const quoteOrderQtyMarketAllowed = markets[market.symbol]?.info?.quoteOrderQtyMarketAllowed;
        if (quoteOrderQtyMarketAllowed !== undefined) {
            market.quoteOrderQtyMarketAllowed = quoteOrderQtyMarketAllowed;
        }
    }

    /**
     * Computes average price based on "fills" array that is returned by Binance
     */
    static computeAveragePrice(fills: [MarketOrderFill]): number {
        let num = 0;
        let denom = 0;
        for (const fill of fills) {
            num += Number(fill.price) * Number(fill.qty);
            denom += Number(fill.qty);
        }
        return NumberUtils.truncateNumber(num/denom, 8);
    }

    /**
     * Converts Binance timestamps into Belgian time
     */
    static toBelgianDateTime(date: string): string {
        try {
            const res = new Date(date);
            res.setHours(res.getHours() + 2);
            return res.toISOString();
        } catch (e) {
            return date;
        }
    }
}