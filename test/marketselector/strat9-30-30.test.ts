import fs from "fs";
import { Market, TOHLCVF } from "../../src/models/market";
import { MountainSeekerV2State } from "../../src/strategies/state/mountain-seeker-v2-state";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { Currency } from "../../src/enums/trading-currencies.enum";
import { SelectBy30min } from "../../src/strategies/marketselector/msv2/select-by-30min";

describe("strat9-30-30 selector", () => {
    const CURRENT_DIRECTORY_PATH = __dirname;
    let candlesticks = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/CFX_30m_candlesticks.json", "utf8")) as Array<TOHLCVF>;
    candlesticks = candlesticks.slice(0, -27);
    let candleSticksPercentageVariations = JSON.parse(fs.readFileSync(CURRENT_DIRECTORY_PATH + "/CFX_30m_candlesticks_percentage_variations.json", "utf8")) as Array<number>;
    candleSticksPercentageVariations = candleSticksPercentageVariations.slice(0, -27);

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
        const res = SelectBy30min.shouldSelectMarket(state, market, "strat9-30-30", false, candlesticks, candleSticksPercentageVariations);
        expect(res).toBeDefined();
        expect(res!.edgeVariation).toEqual(0.9703504043126664);
        expect(res!.maxVariation).toEqual(3.9268423883808503);
        expect(res!.volumeRatio).toEqual(6.281922864809773);
        expect(res!.BUSDVolumeLast5h).toEqual(510650.9174);
        expect(res!.BUSDVolumeLast10h).toEqual(918085.3452000001);
        expect(res!.interval).toEqual(CandlestickInterval.THIRTY_MINUTES);
        expect(res!.c1MaxVarRatio).toEqual(0.7493863330429954);
    });

});