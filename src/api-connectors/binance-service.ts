import { Service } from "typedi";
import * as ccxt from "ccxt";
// eslint-disable-next-line no-duplicate-imports
import { Dictionary, Market } from "ccxt";
import { resourceLimits } from "worker_threads";


/**
 * This service is responsible for communicating with Binance API.
 *
 * It is a wrapper around existing libraries (e.g. ccxt) with
 * possibly additional/custom implementations.
 */
@Service()
export class BinanceService {

    /** Binance ccxt instance */
    private binance;

    constructor() {
        this.binance = new ccxt.binance({
            verbose: false,
            enableRateLimit: true
        });
    }

    public async getMarkets(): Promise<Dictionary<Market>> {
        return this.binance.loadMarkets();
    }

    // For testing
    public async test(): Promise<void> {
        console.log(await this.binance.fetchTickers(["BNB/EUR"]));
        console.log(await this.binance.fetchOHLCV(
            'BNB/EUR',
            '15m',
            undefined,
            3
        ));
    }


}

