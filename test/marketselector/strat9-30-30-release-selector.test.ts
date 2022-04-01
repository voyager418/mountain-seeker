import fs from "fs";
import { Market, TOHLCVF } from "../../src/models/market";
import { MountainSeekerV2State } from "../../src/strategies/state/mountain-seeker-v2-state";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { Currency } from "../../src/enums/trading-currencies.enum";
import { Strat93030ReleaseSelector } from "../../src/strategies/marketselector/msv2/strat9-30-30-release-selector";

describe("strat9-30-30 release selector", () => {
    const CURRENT_DIRECTORY_PATH = __dirname;
    let candlesticks = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/ATOM_30m_candlesticks.json", "utf8")) as Array<TOHLCVF>;
    candlesticks = candlesticks.slice(0, -9);
    let candleSticksPercentageVariations = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/ATOM_30m_candlesticks_percentage_variations.json", "utf8")) as Array<number>;
    candleSticksPercentageVariations = candleSticksPercentageVariations.slice(0, -9);

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
        const res = Strat93030ReleaseSelector.shouldSelectMarket(state, market, candlesticks, candleSticksPercentageVariations, "strat9-30-30-r", true);
        expect(res).toBeUndefined();
    });

});