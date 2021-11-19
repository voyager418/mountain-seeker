import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { v4 as uuidv4 } from 'uuid';
import { BinanceConnector } from "../api-connectors/binance-connector";
import { getCandleSticksPercentageVariationsByInterval, Market } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import { StrategyUtils } from "../utils/strategy-utils";
import { GlobalUtils } from "../utils/global-utils";
import { Order } from "../models/order";
import { EmailService } from "../services/email-service";
import { ConfigService } from "../services/config-service";
import { injectable } from "tsyringe";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";
import * as _ from "lodash";
import { BinanceDataService } from "../services/observer/binance-data-service";
import { MarketConfig, MountainSeekerV2Config, TradingLoopConfig } from "./config/mountain-seeker-v2-config";
import { ATRIndicator } from "../indicators/atr-indicator";
import { MACDIndicator } from "../indicators/macd-indicator";
import { MountainSeekerV2State } from "./state/mountain-seeker-v2-state";


/**
 * Mountain Seeker V2.
 * The general idea is to enter a trade when previous candle increased by a big amount.
 * This strategy uses a trailing stop loss.
 */
@injectable()
export class MountainSeekerV2 implements BaseStrategy {
    /* eslint-disable  @typescript-eslint/no-explicit-any */
    private strategyDetails: any;
    private markets: Array<Market> = [];
    private account: any;
    private initialWalletBalance?: Map<string, number>;
    private state: MountainSeekerV2State;
    private config: MountainSeekerV2Config & BaseStrategyConfig = { maxMoneyToTrade: -1 };
    /** If a loss of -7% or less is reached it means that something went wrong and we abort everything */
    private static MAX_LOSS_TO_ABORT_EXECUTION = -7;
    private market?: Market;
    private latestSellStopLimitOrder?: Order;
    private amountOfTargetAssetThatWasBought?: number;
    private takeProfitATR?: number;
    private stopLossATR?: number;

    constructor(private configService: ConfigService,
        private cryptoExchangePlatform: BinanceConnector,
        private emailService: EmailService,
        private binanceDataService: BinanceDataService,
        private macdIndicator: MACDIndicator,
        private atrIndicator: ATRIndicator) {
        this.state = { id: uuidv4() };
        if (!this.configService.isSimulation() && process.env.NODE_ENV !== "prod") {
            log.warn("WARNING : this is not a simulation");
        }
    }

    getState(): MountainSeekerV2State {
        return this.state;
    }

    public setup(account: Account, strategyDetails: StrategyDetails<MountainSeekerV2Config>): MountainSeekerV2 {
        log.debug(`Adding new strategy ${JSON.stringify(strategyDetails)}`);
        this.account = account;
        this.strategyDetails = strategyDetails;
        this.config = strategyDetails.config;
        this.initDefaultConfig(strategyDetails);
        this.binanceDataService.registerObserver(this);
        return this;
    }

    async update(markets: Array<Market>): Promise<void> {
        if (!this.state.marketSymbol) { // if there is no active trading
            this.markets = markets;
            try {
                await this.run();
                this.prepareForNextTrade();
            } catch (e) {
                await this.abort();
                this.binanceDataService.removeObserver(this);
                const error = new Error(e);
                log.error("Trading was aborted due to an error : ", error);
                await this.emailService.sendEmail("Trading stopped...", error.message);
            }
        }
    }

    private prepareForNextTrade(): void {
        if (this.state.marketSymbol) {
            if (this.state.profitPercent && this.state.profitPercent <= MountainSeekerV2.MAX_LOSS_TO_ABORT_EXECUTION) {
                throw new Error(`Aborting due to a big loss : ${this.state.profitPercent}%`);
            }
            if (!this.config.autoRestartOnProfit) {
                this.binanceDataService.removeObserver(this);
                return;
            }
            this.config.marketLastTradeDate!.set(this.state.marketSymbol, new Date());
            this.state = { id: uuidv4() }; // resetting the state after a trade
            this.latestSellStopLimitOrder = undefined;
            this.amountOfTargetAssetThatWasBought = undefined;
            this.takeProfitATR = undefined;
            this.market = undefined;
        }
    }

    /**
     * Set default config values
     */
    private initDefaultConfig(strategyDetails: StrategyDetails<MountainSeekerV2Config>) {
        this.config.marketLastTradeDate = new Map<string, Date>();
        if (!strategyDetails.config.authorizedCurrencies) {
            this.config.authorizedCurrencies = [Currency.USDT];
        }
        const marketConfigMapFor15min = new Map<string, MarketConfig>();
        const marketConfigMapFor1h = new Map<string, MarketConfig>();
        if (!strategyDetails.config.activeCandleStickIntervals) {
            // 1/4/2021 -> 3/11/2021 / Profit : 39.16% / Total trades : 17 / Profitable 76.47% / Drawdown : 2.13%
            marketConfigMapFor15min.set("BNBUP/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 3,
                maxCandlePercentChange: 4,
                maxBarsSinceMacdCrossover: 5,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 5.4
            });
            // 14/4/2021 -> 3/11/2021 / Profit : 23.96% / Total trades : 12 / Profitable 58.33% / Drawdown : 2.31%
            marketConfigMapFor15min.set("BNBDOWN/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 3.3,
                maxCandlePercentChange: 5.3,
                maxBarsSinceMacdCrossover: 1,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 5.4
            });
            // 1/4/2021 -> 3/11/2021 / Profit : 32.92% / Total trades : 10 / Profitable 90% / Drawdown : 1.65%
            marketConfigMapFor15min.set("ETHUP/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 2.2,
                maxCandlePercentChange: 2.4,
                maxBarsSinceMacdCrossover: 3,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 5.2
            });
            // 9/7/2021 -> 3/11/2021 / Profit : 38.79% / Total trades : 39 / Profitable 51.28% / Drawdown : 5%
            // 9/7/2021 -> 15/11/2021 / Profit : 41.78% / Total trades : 41 / Profitable 48.78% / Drawdown : 5%
            // 9/7/2021 -> 16/11/2021 / Profit : 41.94% / Total trades : 42 / Profitable 50% / Drawdown : 5%
            marketConfigMapFor15min.set("ETHDOWN/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 2,
                maxCandlePercentChange: 3,
                maxBarsSinceMacdCrossover: 4,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 3
            });
            // 1/4/2021 -> 9/11/2021 / Profit : 34.56% / Total trades : 20 / Profitable 60% / Drawdown : 5.24%
            marketConfigMapFor15min.set("ADAUP/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 3.3,
                maxCandlePercentChange: 4.8,
                maxBarsSinceMacdCrossover: 3,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 4.1
            });
            // 8/4/2021 -> 3/11/2021 / Profit : 33.94% / Total trades : 13 / Profitable 69.23% / Drawdown : 2.99%
            marketConfigMapFor15min.set("ADADOWN/USDT", {
                atrPeriod: 12,
                minCandlePercentChange: 2.6,
                maxCandlePercentChange: 3.4,
                maxBarsSinceMacdCrossover: 4,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 6.2
            });
            // 1/4/2021 -> 3/11/2021 / Profit : 22.1% / Total trades : 10 / Profitable 70% / Drawdown : 2.43%
            marketConfigMapFor15min.set("BTCUP/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 1.7,
                maxCandlePercentChange: 2.5,
                maxBarsSinceMacdCrossover: 1,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 5.3
            });
            // 1/4/2021 -> 3/11/2021 / Profit : 35.6% / Total trades : 16 / Profitable 68.75% / Drawdown : 2.9%
            marketConfigMapFor15min.set("BTCDOWN/USDT", {
                atrPeriod: 10,
                minCandlePercentChange: 3.3,
                maxCandlePercentChange: 6,
                maxBarsSinceMacdCrossover: 4,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 3
            });
            // 24/5/2021 -> 4/11/2021 / Profit : 19.38% / Total trades : 7 / Profitable 100% / Drawdown : 0%
            marketConfigMapFor15min.set("EOSUP/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 1.7,
                maxCandlePercentChange: 2,
                maxBarsSinceMacdCrossover: 5,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 6.4
            });
            // 24/5/2021 -> 4/11/2021 / Profit : 19.83% / Total trades : 16 / Profitable 68.75% / Drawdown : 2.69%
            // 24/5/2021 -> 13/11/2021 / Profit : 18.06% / Total trades : 17 / Profitable 64.71% / Drawdown : 2.69%
            marketConfigMapFor15min.set("LTCUP/USDT", {
                atrPeriod: 10,
                minCandlePercentChange: 2.7,
                maxCandlePercentChange: 3.2,
                maxBarsSinceMacdCrossover: 2,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 3
            });
            // 1/4/2021 -> 4/11/2021 / Profit : 16.93 / Total trades : 8 / Profitable 87.5% / Drawdown : 1.69%
            marketConfigMapFor15min.set("BTC/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 1.9,
                maxCandlePercentChange: 2.9,
                maxBarsSinceMacdCrossover: 5,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 3
            });
            // 1/4/2021 -> 4/11/2021 / Profit : 35.24 / Total trades : 12 / Profitable 75% / Drawdown : 2.23%
            marketConfigMapFor15min.set("SOL/USDT", {
                atrPeriod: 14,
                minCandlePercentChange: 2.5,
                maxCandlePercentChange: 5,
                maxBarsSinceMacdCrossover: 2,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 6.2
            });
            // 24/5/2021 -> 4/11/2021 / Profit : 30.2% / Total trades : 14 / Profitable 71.43% / Drawdown : 1.72%
            marketConfigMapFor15min.set("DOTUP/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 2.1,
                maxCandlePercentChange: 2.4,
                maxBarsSinceMacdCrossover: 1,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 3
            });
            // 22/10/2021 -> 9/11/2021 / Profit : 14.89% / Total trades : 12 / Profitable 58.33% / Drawdown : 2.42%
            // marketConfigMapFor15min.set("DOTDOWN/USDT", {
            //     atrPeriod: 7,
            //     minCandlePercentChange: 1.1,
            //     maxCandlePercentChange: 1.9,
            //     maxBarsSinceMacdCrossover: 3,
            //     stopLossATRMultiplier: 1,
            //     takeProfitATRMultiplier: 3,
            //     minTakeProfit: 4.1
            // });
            // 24/5/2021 -> 4/11/2021 / Profit : 13.99% / Total trades : 6 / Profitable 83.33% / Drawdown : 1.11%
            marketConfigMapFor15min.set("YFIUP/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 1.2,
                maxCandlePercentChange: 2.7,
                maxBarsSinceMacdCrossover: 3,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 7.3
            });
            // 24/5/2021 -> 4/11/2021 / Profit : 14.49% / Total trades : 6 / Profitable 66.67% / Drawdown : 1.21%
            marketConfigMapFor15min.set("EOSDOWN/USDT", {
                atrPeriod: 14,
                minCandlePercentChange: 5.5,
                maxCandlePercentChange: 6.7,
                maxBarsSinceMacdCrossover: 3,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 2,
                minTakeProfit: 3
            });
            // 9/8/2021 -> 4/11/2021 / Profit : 9.53% / Total trades : 8 / Profitable 75% / Drawdown : 2.35%
            marketConfigMapFor15min.set("YFIDOWN/USDT", {
                atrPeriod: 7,
                minCandlePercentChange: 2.9,
                maxCandlePercentChange: 3.2,
                maxBarsSinceMacdCrossover: 2,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 3,
                minTakeProfit: 4.5
            });
            const configFor15min: TradingLoopConfig = {
                secondsToSleepInTheTradingLoop: 5,
                marketConfig: marketConfigMapFor15min,
                stopTradingMaxPercentLoss: -2.5
            };

            marketConfigMapFor1h.set("DEFAULT", {
                atrPeriod: 7,
                minCandlePercentChange: 6,
                maxCandlePercentChange: 14.5,
                maxBarsSinceMacdCrossover: Infinity,
                stopLossATRMultiplier: 1,
                takeProfitATRMultiplier: 2,
                minTakeProfit: -Infinity
            });
            const configFor1h: TradingLoopConfig = {
                secondsToSleepInTheTradingLoop: 5,
                marketConfig: marketConfigMapFor1h,
                stopTradingMaxPercentLoss: -2.5
            };
            this.config.activeCandleStickIntervals = new Map([
                [CandlestickInterval.FIFTEEN_MINUTES, configFor15min],
                [CandlestickInterval.ONE_HOUR, configFor1h]
            ]);
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.config.minimumPercentFor24hVariation = -1000;
        }
        if (!strategyDetails.config.privilegedMarkets) {
            // sorted by order of preference
            this.config.privilegedMarkets = Array.from(marketConfigMapFor15min!.keys());
        }
    }

    public async run(): Promise<void> {
        // 1. Filter and select market
        this.markets = this.getFilteredMarkets();
        this.market = await this.selectMarketForTrading(this.markets).catch(e => Promise.reject(e));
        // this.market = this.markets[0];
        // this.state.selectedCandleStickInterval = CandlestickInterval.FIFTEEN_MINUTES;
        // this.state.stopLossPrice = 100;

        if (!this.market) {
            if (this.configService.isSimulation()) {
                log.debug("No market was found");
            }
            return Promise.resolve();
        }

        log.debug(`Using config : ${JSON.stringify(this.strategyDetails)}`);
        this.state.marketSymbol = this.market.symbol;
        this.cryptoExchangePlatform.printMarketDetails(this.market);
        this.state.marketPercentChangeLast24h = this.market.percentChangeLast24h;
        this.state.last5CandleSticksPercentageVariations = getCandleSticksPercentageVariationsByInterval(this.market,
            this.state.selectedCandleStickInterval!).slice(-5);
        log.info("Found market %O", this.market.symbol);

        // 2. Fetch wallet balance and compute amount of USDT to invest
        await this.getInitialBalance([Currency.USDT.toString(), this.market.targetAsset]);
        const availableUsdtAmount = this.initialWalletBalance?.get(Currency.USDT.toString());
        const currentMarketPrice = await this.cryptoExchangePlatform.getUnitPrice(Currency.USDT, this.market.targetAsset, false, 5)
            .catch(e => Promise.reject(e));
        const usdtAmountToInvest = this.computeAmountToInvest(availableUsdtAmount!,
            ((this.market.maxPosition! - this.initialWalletBalance!.get(this.market.targetAsset)!) * currentMarketPrice));

        // 3. First BUY MARKET order to buy market.targetAsset
        const buyOrder = await this.createFirstMarketBuyOrder(usdtAmountToInvest, currentMarketPrice).catch(e => Promise.reject(e));
        this.amountOfTargetAssetThatWasBought = buyOrder.filled;
        this.state.takeProfitPrice = buyOrder.average + this.takeProfitATR!;

        // 4. First SELL STOP LIMIT order
        this.state.stopLossPrice = buyOrder.average - this.stopLossATR!;
        this.state.stopLossPrice = GlobalUtils.truncateNumber(this.state.stopLossPrice!, this.market.pricePrecision!);
        this.emailService.sendInitialEmail(this.market, buyOrder.amountOfOriginAsset!, this.state.stopLossPrice,
            this.state.takeProfitPrice, buyOrder.average, this.initialWalletBalance!).then().catch(e => log.error(e));
        const firstSellStopLimitOrder = await this.cryptoExchangePlatform.createStopLimitOrder(this.market.originAsset, this.market.targetAsset,
            "sell", buyOrder.filled, this.state.stopLossPrice, this.state.stopLossPrice, 5).catch(e => Promise.reject(e));
        this.latestSellStopLimitOrder = firstSellStopLimitOrder;
        this.state.stopLossPrice = firstSellStopLimitOrder.stopPrice;

        // 5. Start price monitor loop
        const lastSellStopLimitOrder = await this.runTradingLoop(buyOrder, firstSellStopLimitOrder, buyOrder.filled)
            .catch(e => Promise.reject(e));

        // 6. Finishing
        return await this.handleTradeEnd(buyOrder, lastSellStopLimitOrder).catch(e => Promise.reject(e));
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, sellStopLimitOrder: Order, targetAssetAmount: number): Promise<Order> {
        const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!;
        let tempStopLossPrice = this.state.stopLossPrice!;
        let lastOrder = sellStopLimitOrder;
        let worstCaseProfit;
        let marketUnitPrice = Infinity;
        this.state.runUp = -Infinity;
        this.state.drawDown = Infinity;
        let priceChange;
        const marketConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!
            .marketConfig.get(this.state.selectedCandleStickInterval! === CandlestickInterval.FIFTEEN_MINUTES ? this.market!.symbol : "DEFAULT")!;

        while (this.state.stopLossPrice! < marketUnitPrice &&
            StrategyUtils.getPercentVariation(buyOrder.average, marketUnitPrice) > tradingLoopConfig.stopTradingMaxPercentLoss) {
            await GlobalUtils.sleep(tradingLoopConfig.secondsToSleepInTheTradingLoop);

            if ((await this.cryptoExchangePlatform.orderIsClosed(lastOrder.externalId, lastOrder.originAsset, lastOrder.targetAsset,
                lastOrder.id, lastOrder.type!, 300).catch(e => Promise.reject(e)))) {
                break;
            }
            marketUnitPrice = await this.cryptoExchangePlatform.getUnitPrice(this.market!.originAsset, this.market!.targetAsset, false, 10)
                .catch(e => Promise.reject(e));

            // if take profit target is reached or if max loss is reached
            if (marketUnitPrice >= this.state.takeProfitPrice!) {
                // cancel the previous sell limit order
                await this.cryptoExchangePlatform.cancelOrder(lastOrder.externalId, sellStopLimitOrder.id,
                    this.market!.originAsset, this.market!.targetAsset, 5).catch(e => Promise.reject(e));

                // sell everything
                lastOrder = await this.cryptoExchangePlatform.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                    targetAssetAmount, true, 5).catch(e => Promise.reject(e));
                break;
            }

            // computing ATR and a new trailing stop loss based on the before last candlestick
            const updatedCandleSticks = await this.cryptoExchangePlatform.getCandlesticks(this.market!.symbol, this.state.selectedCandleStickInterval!,
                50, 5).catch(e => Promise.reject(e));
            const ATR = this.atrIndicator.compute(updatedCandleSticks, { period: marketConfig.atrPeriod }).result.reverse()[1];
            const stopLossATR = marketConfig.stopLossATRMultiplier * ATR;
            const close = StrategyUtils.getCandleStick(updatedCandleSticks, 1)[4];

            if (this.eligibleToIncreaseStopPrice(close, stopLossATR, tempStopLossPrice, this.state.selectedCandleStickInterval!)) {
                tempStopLossPrice = GlobalUtils.truncateNumber(close - stopLossATR, this.market!.pricePrecision!);
                log.debug(`Updating stop loss price to : ${tempStopLossPrice}`);
                // cancel the previous sell limit order
                await this.cryptoExchangePlatform.cancelOrder(lastOrder.externalId, sellStopLimitOrder.id,
                    this.market!.originAsset, this.market!.targetAsset, 5).catch(e => Promise.reject(e));

                // create new sell stop limit order
                lastOrder = await this.cryptoExchangePlatform.createStopLimitOrder(this.market!.originAsset, this.market!.targetAsset,
                    "sell", targetAssetAmount, tempStopLossPrice, tempStopLossPrice, 3).catch(e => Promise.reject(e));
                this.latestSellStopLimitOrder = lastOrder;
                this.state.stopLossPrice = lastOrder.limitPrice!;
            }
            priceChange = Number(StrategyUtils.getPercentVariation(buyOrder.average, marketUnitPrice).toFixed(3));
            this.state.runUp = Math.max(this.state.runUp, priceChange);
            this.state.drawDown = Math.min(this.state.drawDown, priceChange);

            worstCaseProfit = StrategyUtils.getPercentVariation(buyOrder.average, GlobalUtils.decreaseNumberByPercent(this.state.stopLossPrice!, 0.1));
            log.info(`Buy : ${buyOrder.average.toFixed(this.market?.pricePrecision)}, current : ${(marketUnitPrice)
                .toFixed(this.market?.pricePrecision)}, change % : ${priceChange}% | Sell : ${(this.state.stopLossPrice!).toFixed(this.market?.pricePrecision)} | Wanted profit : ${
                StrategyUtils.getPercentVariation(buyOrder.average, this.state.takeProfitPrice!).toFixed(3)}% | Worst case profit ≈ ${worstCaseProfit.toFixed(3)}%`);
        }
        return Promise.resolve(lastOrder);
    }

    /**
     * @return `true` if stop price can be increased
     */
    private eligibleToIncreaseStopPrice(close: number, stopLossATR: number, tempStopLossPrice: number, candlestickInterval: CandlestickInterval): boolean {
        if (!(GlobalUtils.truncateNumber(close - stopLossATR, this.market!.pricePrecision!) > tempStopLossPrice)) {
            return false;
        }
        // this is to avoid to increase immediately the price when default candlestick interval is 5min
        // and for example the first buy order was done at 12h10
        if (candlestickInterval === CandlestickInterval.FIFTEEN_MINUTES) {
            const currentTime = new Date();
            const currentMinute = currentTime.getMinutes();
            return currentMinute < 5 || (currentMinute >= 15 && currentMinute < 20) ||
                (currentMinute >= 30 && currentMinute < 35) || (currentMinute >= 45 && currentMinute < 50);
        }
        return true;
    }

    private async handleTradeEnd(firstBuyOrder: Order, lastOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder = await this.cryptoExchangePlatform.waitForOrderCompletion(lastOrder, this.market!.originAsset,
            this.market!.targetAsset, 3).catch(e => Promise.reject(e));
        if (!completedOrder) { // LIMIT order took too long => use a MARKET order
            await this.cryptoExchangePlatform.cancelOrder(lastOrder.externalId, lastOrder.id,
                lastOrder.originAsset, lastOrder.targetAsset, 5).catch(e => Promise.reject(e));
            completedOrder = await this.cryptoExchangePlatform.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                lastOrder.amountOfTargetAsset, true, 5).catch(e => Promise.reject(e));
        }

        this.state.retrievedAmountOfUsdt = completedOrder!.amountOfOriginAsset!;
        await this.handleRedeem();

        this.state.profitUsdt = this.state.retrievedAmountOfUsdt! - this.state.investedAmountOfUsdt!;
        this.state.profitPercent = StrategyUtils.getPercentVariation(this.state.investedAmountOfUsdt!, this.state.retrievedAmountOfUsdt!);

        const endWalletBalance = await this.cryptoExchangePlatform.getBalance([Currency.USDT.toString(), this.market!.targetAsset], 3, true)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendFinalMail(this.market!, firstBuyOrder.amountOfOriginAsset!, this.state.retrievedAmountOfUsdt!,
            this.state.profitUsdt, this.state.profitPercent, this.initialWalletBalance!, endWalletBalance).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        // TODO print full account object when api key/secret are moved to DB
        log.info(`Final percent change : ${this.state.profitPercent.toFixed(2)} | State : ${JSON.stringify(this.state)}
         | Account : ${JSON.stringify(this.account.email)} | Strategy : ${this.strategyDetails}`);
        return Promise.resolve();
    }

    /**
     * Sometimes Binance is not able to sell everything so in this method, if the market is BLVT,
     * we will try to sell the remaining amount. In order to add it to the profit
     */
    private async handleRedeem(): Promise<void> {
        if (!this.market?.quoteOrderQtyMarketAllowed) {
            try {
                const amountNotSold = await this.cryptoExchangePlatform.getBalanceForAsset(this.market!.targetAsset, 3);
                if (amountNotSold && amountNotSold > 0) {
                    const redeemOrder = await this.cryptoExchangePlatform.redeemBlvt(this.market!.targetAsset!, amountNotSold, 5);
                    if (this.state.retrievedAmountOfUsdt) {
                        this.state.retrievedAmountOfUsdt += redeemOrder.amount;
                    } else {
                        this.state.retrievedAmountOfUsdt = redeemOrder.amount;
                    }
                }
            } catch (e) {
                log.error(`Failed to redeem BLVT : ${JSON.stringify(e)}`)
            }
        }
    }

    /**
     * If the market accepts quote price then it will create a BUY MARKET order by specifying how much we want to spend.
     * Otherwise it will compute the equivalent amount of target asset and make a different buy order.
     */
    private async createFirstMarketBuyOrder(usdtAmountToInvest: number, currentMarketPrice: number): Promise<Order> {
        let buyOrder;
        const retries = 5;
        if (this.market!.quoteOrderQtyMarketAllowed) {
            log.debug("Preparing to execute the first buy order on %O market to invest %OUSDT", this.market!.symbol, usdtAmountToInvest);
            buyOrder = await this.cryptoExchangePlatform.createMarketBuyOrder(this.market!.originAsset, this.market!.targetAsset,
                usdtAmountToInvest, true, retries).catch(e => Promise.reject(e));
        } else {
            const amountToBuy = usdtAmountToInvest / currentMarketPrice;
            log.debug("Preparing to execute the first buy order on %O market to buy %O%O", this.market!.symbol, amountToBuy, this.market!.targetAsset);
            buyOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset, this.market!.targetAsset,
                "buy", usdtAmountToInvest / currentMarketPrice, true, retries, usdtAmountToInvest, this.market!.amountPrecision)
                .catch(e => Promise.reject(e));
        }
        this.state.investedAmountOfUsdt = buyOrder.amountOfOriginAsset;
        return buyOrder;
    }

    /**
     * Searches the best market based on some criteria.
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private async selectMarketForTrading(markets: Array<Market>): Promise<Market | undefined> {
        const potentialMarkets: Array<{market: Market, interval: CandlestickInterval, takeProfitATR: number, stopLossATR: number}> = [];
        for (const market of markets) {
            for (const interval of _.intersection(market.candleStickIntervals,
                Array.from(this.config.activeCandleStickIntervals!.keys()))) {
                switch (interval) {
                case CandlestickInterval.FIFTEEN_MINUTES:
                    this.selectMarketByFifteenMinutesCandleSticks(market, potentialMarkets);
                    break;
                case CandlestickInterval.ONE_HOUR:
                    this.selectMarketByOneHourCandleSticks(market, potentialMarkets);
                    break;
                default:
                    return Promise.reject(`Unable to select a market due to unknown or unhandled candlestick interval : ${interval}`);
                }
            }
        }

        if (potentialMarkets.length === 0) {
            return Promise.resolve(undefined);
        }

        let selectedMarket;
        const potentialMarketSymbols = potentialMarkets.map(element => element.market.symbol);
        for (const marketSymbol of this.config.privilegedMarkets!) {
            if (potentialMarketSymbols.includes(marketSymbol)) {
                selectedMarket = potentialMarkets.filter(element => element.market.symbol === marketSymbol)[0];
                if (selectedMarket.interval === CandlestickInterval.FIFTEEN_MINUTES) {
                    this.state.selectedCandleStickInterval = selectedMarket.interval;
                    this.takeProfitATR = selectedMarket.takeProfitATR;
                    this.stopLossATR = selectedMarket.stopLossATR;
                    return Promise.resolve(selectedMarket.market);
                }
            }
        }
        if (potentialMarkets.length > 0) {
            this.state.selectedCandleStickInterval = potentialMarkets[0].interval;
            this.takeProfitATR = potentialMarkets[0].takeProfitATR;
            this.stopLossATR = potentialMarkets[0].stopLossATR;
            return Promise.resolve(potentialMarkets[0].market);
        }
    }

    private selectMarketByFifteenMinutesCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval,
        takeProfitATR: number, stopLossATR: number}>) {

        // TODO instead of privileged use markets defined for 15min config
        if (!this.config.privilegedMarkets!.includes(market.symbol)) {
            return;
        }

        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = this.config.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return;
        }

        const marketConfig = this.config.activeCandleStickIntervals!.get(CandlestickInterval.FIFTEEN_MINUTES)!
            .marketConfig.get(market.symbol)!;
        const beforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(market.candleSticksPercentageVariations
            .get(CandlestickInterval.FIFTEEN_MINUTES)!, 1);

        // if before last candle percent change is below minimal threshold
        if (beforeLastCandlestickPercentVariation < marketConfig.minCandlePercentChange!) {
            return;
        }

        // if before last candle percent change is above maximal threshold
        if (beforeLastCandlestickPercentVariation > marketConfig.maxCandlePercentChange!) {
            return;
        }

        const beforeBeforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(market.candleSticksPercentageVariations
            .get(CandlestickInterval.FIFTEEN_MINUTES)!, 2);
        // if before before last candle had already a big variation, then it's considered as too late
        if (beforeBeforeLastCandlestickPercentVariation > marketConfig.maxCandlePercentChange) {
            return;
        }

        const macdResult = this.macdIndicator.compute(market.candleSticks.get(CandlestickInterval.FIFTEEN_MINUTES)!);
        const barsSinceCrossover = StrategyUtils.barsSince(StrategyUtils.crossover,
            macdResult.result.map(res => res.MACD!), macdResult.result.map(res => res.signal!));
        if (barsSinceCrossover === 0 || barsSinceCrossover > marketConfig.maxBarsSinceMacdCrossover) {
            return;
        }

        const beforeLastCandlestick = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.FIFTEEN_MINUTES)!, 1);
        // if variation between close and high of the before last candle is too high
        if (StrategyUtils.getPercentVariation(beforeLastCandlestick[4], beforeLastCandlestick[2]) > 1) {
            return;
        }

        const ATR = this.atrIndicator.compute(market.candleSticks.get(CandlestickInterval.FIFTEEN_MINUTES)!,
            { period: marketConfig.atrPeriod }).result.reverse()[1];
        const stopLossATR = marketConfig.stopLossATRMultiplier * ATR;
        const takeProfitATR = marketConfig.takeProfitATRMultiplier * ATR;
        const close = beforeLastCandlestick[4];

        const takeProfitPrice = close + takeProfitATR;
        const minTakeProfit = close * (1 + (marketConfig.minTakeProfit / 100));
        if (takeProfitPrice < minTakeProfit) {
            return;
        }

        const stopLossPrice = close - stopLossATR;
        const maxStopLoss = close * (1 - (Math.abs(this.config.activeCandleStickIntervals!
            .get(CandlestickInterval.FIFTEEN_MINUTES)!.stopTradingMaxPercentLoss) / 100));
        if (stopLossPrice < maxStopLoss) {
            return;
        }

        log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.FIFTEEN_MINUTES);
        potentialMarkets.push({ market, interval: CandlestickInterval.FIFTEEN_MINUTES, takeProfitATR, stopLossATR });
    }

    private selectMarketByOneHourCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval,
        takeProfitATR: number, stopLossATR: number}>) {

        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = this.config.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return;
        }

        // if not the start of new hour (start = first 5minutes)
        const lastCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!, 0);
        if (new Date(lastCandle[0]).getMinutes() > 5) {
            return;
        }

        const marketConfig = this.config.activeCandleStickIntervals!.get(CandlestickInterval.ONE_HOUR)!
            .marketConfig.get("DEFAULT")!;
        const beforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(market.candleSticksPercentageVariations
            .get(CandlestickInterval.ONE_HOUR)!, 1);

        // if before last candle percent change is below minimal threshold
        if (beforeLastCandlestickPercentVariation < marketConfig.minCandlePercentChange!) {
            return;
        }

        // if before last candle percent change is above maximal threshold
        if (beforeLastCandlestickPercentVariation > marketConfig.maxCandlePercentChange!) {
            return;
        }

        // if 1 of 20 variations except the 2 latest are > 2.5%
        const allVariations = market.candleSticksPercentageVariations.get(CandlestickInterval.ONE_HOUR)!;
        const selectedTwenty = allVariations.slice(allVariations.length - 22, -2);
        if (selectedTwenty.some(variation => variation > 2.4)) {
            return;
        }

        // if the line is not +/- horizontal
        const twentienthCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!, 21);
        const beforeBeforeLastCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!, 2);
        if (StrategyUtils.getPercentVariation(twentienthCandle[4], beforeBeforeLastCandle[4]) > 5 ||
            StrategyUtils.getPercentVariation(twentienthCandle[4], beforeBeforeLastCandle[4]) < -2) {
            return;
        }

        const beforeLastCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!, 1);

        // if close below previous close
        if (beforeLastCandle[4] > lastCandle[4]) {
            return;
        }

        // if variation between close and high is too big
        if (StrategyUtils.getPercentVariation(beforeLastCandle[4], beforeLastCandle[4]) > 2) {
            return;
        }

        const macdResult = this.macdIndicator.compute(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!);
        if (!macdResult.shouldBuy) {
            return;
        }

        const ATR = this.atrIndicator.compute(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!,
            { period: marketConfig.atrPeriod }).result.reverse()[1];
        const stopLossATR = marketConfig.stopLossATRMultiplier * ATR;
        const takeProfitATR = marketConfig.takeProfitATRMultiplier * ATR;
        const beforeLastCandlestick = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!, 1);
        const close = beforeLastCandlestick[4];

        const takeProfitPrice = close + takeProfitATR;
        const minTakeProfit = close * (1 + (marketConfig.minTakeProfit / 100));
        if (takeProfitPrice < minTakeProfit) {
            return;
        }

        const stopLossPrice = close - stopLossATR;
        const maxStopLoss = close * (1 - (Math.abs(this.config.activeCandleStickIntervals!
            .get(CandlestickInterval.ONE_HOUR)!.stopTradingMaxPercentLoss) / 100));
        if (stopLossPrice < maxStopLoss) {
            return;
        }

        log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.ONE_HOUR);
        potentialMarkets.push({ market, interval: CandlestickInterval.ONE_HOUR, takeProfitATR, stopLossATR });
    }

    /**
     * @return All potentially interesting markets after filtering based on various criteria
     */
    private getFilteredMarkets(): Array<Market> {
        this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, this.config.authorizedCurrencies);
        this.markets = StrategyUtils.filterByIgnoredMarkets(this.markets, this.config.ignoredMarkets);
        this.markets = StrategyUtils.filterByMinimumTradingVolume(this.markets, 100000);
        this.markets = StrategyUtils.filterByAmountPrecision(this.markets, 1); // when trading with big price amounts, this can maybe be removed
        return this.markets;
    }

    /**
     * Fetches wallet information
     */
    private async getInitialBalance(assets: Array<string>): Promise<void> {
        this.initialWalletBalance = await this.cryptoExchangePlatform.getBalance(assets, 3)
            .catch(e => Promise.reject(e));
        this.state.initialWalletBalance = JSON.stringify(Array.from(this.initialWalletBalance!.entries()));
        log.info("Initial wallet balance : %O", this.initialWalletBalance);
        return Promise.resolve();
    }

    /**
     * @return The amount of {@link Currency.USDT} that will be invested (the minimum between the available
     * and the max money to trade)
     */
    private computeAmountToInvest(availableAmountOfUsdt: number, maxAmountToBuy: number): number {
        return Math.min(availableAmountOfUsdt, this.config.maxMoneyToTrade, maxAmountToBuy);
    }

    /**
     * First tries to cancel the stop limit order and then tries to sell {@link Market.targetAsset}
     */
    private async abort(): Promise<void> {
        if (this.latestSellStopLimitOrder && this.latestSellStopLimitOrder.externalId) {
            log.debug(`Aborting - cancelling order ${JSON.stringify(this.latestSellStopLimitOrder)}`);
            try {
                await this.cryptoExchangePlatform.cancelOrder(this.latestSellStopLimitOrder?.externalId,
                    this.latestSellStopLimitOrder?.id, this.latestSellStopLimitOrder.originAsset,
                    this.latestSellStopLimitOrder.targetAsset, 5);
            } catch (e) {
                log.error(`Error while cancelling order ${this.latestSellStopLimitOrder.externalId}: ${JSON.stringify(e)}`);
            }
        }

        if (this.amountOfTargetAssetThatWasBought) {
            log.debug(`Aborting - selling ${this.amountOfTargetAssetThatWasBought} ${this.market?.targetAsset}`);
            let sellMarketOrder;
            try {
                sellMarketOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset!,
                this.market!.targetAsset!, "sell", this.amountOfTargetAssetThatWasBought, true, 3);
            } catch (e) {
                log.error(`Error while creating market sell order : ${JSON.stringify(e)}`);
            }

            if (!sellMarketOrder) {
                for (const percent of [0.05, 0.5, 1, 2]) {
                    this.amountOfTargetAssetThatWasBought = GlobalUtils.decreaseNumberByPercent(
                        this.amountOfTargetAssetThatWasBought, percent);
                    try {
                        sellMarketOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset!,
                            this.market!.targetAsset!, "sell", this.amountOfTargetAssetThatWasBought,
                            true, 3);
                        if (sellMarketOrder) {
                            break;
                        }
                    } catch (e) {
                        log.error(`Exception occurred while creating market sell order : ${JSON.stringify(e)}`);
                    }
                }
            }
        }
    }
}