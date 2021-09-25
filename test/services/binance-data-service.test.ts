import "reflect-metadata";
import { BinanceConnector } from "../../src/api-connectors/binance-connector";
import { GlobalUtils } from "../../src/utils/global-utils";
import { ConfigService } from "../../src/services/config-service";
import createMockInstance from "jest-create-mock-instance";
import { BinanceDataService } from "../../src/services/observer/binance-data-service";
import { DynamodbRepository } from "../../src/repository/dynamodb-repository";
import { TestHelper } from "../test-helper";
import { CandlestickInterval } from "../../src/enums/candlestick-interval.enum";
import { StrategyUtils } from "../../src/utils/strategy-utils";
import { Currency } from "../../src/enums/trading-currencies.enum";


describe("Binance data service", () => {
    let binanceDataService: BinanceDataService;
    let binanceConnector: BinanceConnector;
    let configService: ConfigService;
    let repository: DynamodbRepository;

    beforeAll(() => {
        jest.spyOn(GlobalUtils, 'sleep').mockImplementation(() => Promise.resolve());
        binanceConnector = createMockInstance(BinanceConnector);
        configService = TestHelper.getMockedConfigService();
        repository = createMockInstance(DynamodbRepository);
        binanceDataService = new BinanceDataService(configService, repository, binanceConnector);
    });

    describe("getMarketsFromBinance", () => {
        beforeAll(() => {
            binanceConnector.getMarketsBy24hrVariation = jest.fn(async() => TestHelper.getMarketsWith30mCandleSticks());
            binanceConnector.fetchCandlesticks = jest.fn(async() => Promise.resolve());
        });

        test("Should correctly fetch, construct candlesticks and filter markets", async() => {
            // arrange
            jest.spyOn(StrategyUtils, 'filterByAuthorizedCurrencies').mockImplementation(() => TestHelper.getMarketsWith30mCandleSticks());
            jest.spyOn(StrategyUtils, 'filterByMinimumTradingVolume').mockImplementation(() => TestHelper.getMarketsWith30mCandleSticks());
            jest.spyOn(StrategyUtils, 'filterByMinimumAmountOfCandleSticks').mockImplementation(() => TestHelper.getMarketsWith30mCandleSticks());
            jest.spyOn(StrategyUtils, 'filterByStrangeMarkets').mockImplementation(() => TestHelper.getMarketsWith30mCandleSticks());
            jest.spyOn(StrategyUtils, 'setCandlestickPercentVariations').mockImplementation();
            jest.spyOn(StrategyUtils, 'addCandleSticksWithInterval').mockImplementation();

            // act
            await binanceDataService.getMarketsFromBinance();

            // assert
            expect(binanceConnector.getMarketsBy24hrVariation).toHaveBeenCalledWith(-1000);
            expect(StrategyUtils.filterByAuthorizedCurrencies).toHaveBeenCalledWith(TestHelper.getMarketsWith30mCandleSticks(),
                [Currency.EUR]);

            expect(binanceConnector.fetchCandlesticks).toHaveBeenCalledWith(TestHelper.getMarketsWith30mCandleSticks(),
                CandlestickInterval.THIRTY_MINUTES, 500);
            expect(StrategyUtils.filterByMinimumAmountOfCandleSticks).toHaveBeenCalledWith(TestHelper.getMarketsWith30mCandleSticks(),
                50, CandlestickInterval.THIRTY_MINUTES);
            expect(StrategyUtils.filterByStrangeMarkets).toHaveBeenCalledWith(expect.anything(), CandlestickInterval.THIRTY_MINUTES);

            expect(StrategyUtils.setCandlestickPercentVariations).toHaveBeenNthCalledWith(1,
                expect.anything(), CandlestickInterval.THIRTY_MINUTES);
            expect(StrategyUtils.setCandlestickPercentVariations).toHaveBeenNthCalledWith(2,
                expect.anything(), CandlestickInterval.ONE_HOUR);
            expect(StrategyUtils.setCandlestickPercentVariations).toHaveBeenNthCalledWith(3,
                expect.anything(), CandlestickInterval.FOUR_HOURS);
            expect(StrategyUtils.setCandlestickPercentVariations).toHaveBeenNthCalledWith(4,
                expect.anything(), CandlestickInterval.SIX_HOURS);

            expect(StrategyUtils.addCandleSticksWithInterval).toHaveBeenNthCalledWith(1,
                expect.anything(), CandlestickInterval.ONE_HOUR);
            expect(StrategyUtils.addCandleSticksWithInterval).toHaveBeenNthCalledWith(2,
                expect.anything(), CandlestickInterval.FOUR_HOURS);
            expect(StrategyUtils.addCandleSticksWithInterval).toHaveBeenNthCalledWith(3,
                expect.anything(), CandlestickInterval.SIX_HOURS);
        });
    });

});

