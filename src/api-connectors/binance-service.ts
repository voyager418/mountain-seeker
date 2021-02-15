import { Service } from "typedi";
import * as ccxt from "ccxt";
import { Dictionary, Market } from "ccxt";


/**
 * This service is responsible for communicating with Binance API.
 *
 * It is a wrapper around existing libraries (e.g. ccxt) with
 * possibly additional/custom implementations.
 */
@Service()
export class BinanceService {

    /** Public binance API ccxt instance */
    private binance;

    constructor() {
        this.binance = new ccxt.binance();
    }

    public async getMarkets(): Promise<Dictionary<Market>> {
        return this.binance.loadMarkets();
    }


}

