import fs from "fs";
import { Market, TOHLCVF } from "../../src/models/market";
import { SelectBy5min } from "../../src/strategies/marketselector/msv2/select-by-5min";
import { MountainSeekerV2State } from "../../src/strategies/state/mountain-seeker-v2-state";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { Currency } from "../../src/enums/trading-currencies.enum";

describe("strat4-5-5 selector", () => {
    const CURRENT_DIRECTORY_PATH = __dirname;
    const candlesticks = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/FIDA_5m_candlesticks.json", "utf8")) as Array<TOHLCVF>;
    const candleSticksPercentageVariations = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/FIDA_5m_candlesticks_percentage_variations.json", "utf8")) as Array<number>;

    let rareCandlesticks = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/RARE_5m_candlesticks.json", "utf8")) as Array<TOHLCVF>;
    rareCandlesticks = rareCandlesticks.slice(0, -284);
    let rareCandleSticksPercentageVariations = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/RARE_5m_candlesticks_percentage_variations.json", "utf8")) as Array<number>;
    rareCandleSticksPercentageVariations = rareCandleSticksPercentageVariations.slice(0, -284);

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
        const res = SelectBy5min.shouldSelectMarket(state, market, "strat4-5-5", false, candlesticks, candleSticksPercentageVariations);
        expect(res).toBeDefined();
        expect(res!.edgeVariation).toEqual(1.447);
        expect(res!.maxVariation).toEqual(1.794);
        expect(res!.volumeRatio).toEqual(85.65856980703745);
    });

    test("Should not select", () => {
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
        const res = SelectBy5min.shouldSelectMarket(state, market, "strat4-5-5", false, rareCandlesticks, rareCandleSticksPercentageVariations);
        expect(res).toBeUndefined(); // because c2 variation is 0.7
    });

});