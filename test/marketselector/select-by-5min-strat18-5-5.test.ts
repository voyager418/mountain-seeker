import fs from "fs";
import { Market, TOHLCVF } from "../../src/models/market";
import { MountainSeekerV2State } from "../../src/strategies/state/mountain-seeker-v2-state";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { Currency } from "../../src/enums/trading-currencies.enum";
import { SelectBy5minV4 } from "../../src/strategies/marketselector/msv2/select-by-5min-v4";

describe("strat18-5-5 selector", () => {
    const CURRENT_DIRECTORY_PATH = __dirname;
    let candlesticks = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/IQ_5m_candlesticks.json", "utf8")) as Array<TOHLCVF>;
    candlesticks = candlesticks.slice(0, -108);
    let candleSticksPercentageVariations = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/IQ_5m_candlesticks_percentage_variations.json", "utf8")) as Array<number>;
    candleSticksPercentageVariations = candleSticksPercentageVariations.slice(0, -108);

    test("Should correctly select", () => {
        const state: MountainSeekerV2State = { accountEmail: "", id: "", marketLastTradeDate: new Map<string, Date>() };
        const market: Market = {
            candleStickIntervals: [],
            candleSticks: new Map<CandlestickInterval, Array<TOHLCVF>>(),
            candleSticksPercentageVariations: new Map<CandlestickInterval, Array<number>>(),
            originAsset: Currency.BUSD,
            symbol: "",
            targetAsset: "",
            targetAssetPrice: 0,
            percentChangeLast24h: 3
        };
        const res = SelectBy5minV4.shouldSelectMarket(state, market, "strat18-5-5", false, candlesticks, candleSticksPercentageVariations);
        expect(res).toBeDefined();
        expect(res!.edgeVariation).toEqual(0.336);
        expect(res!.maxVariation).toEqual(1.342);
        expect(res!.volumeRatio).toEqual(1405.1687065680342);
    });

});