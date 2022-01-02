import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { v4 as uuidv4 } from 'uuid';
import { BinanceConnector } from "../api-connectors/binance-connector";
import { getCandleSticksByInterval, getCandleSticksPercentageVariationsByInterval, Market, TOHLCV } from "../models/market";
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
import { MountainSeekerV2Config, TradingLoopConfig } from "./config/mountain-seeker-v2-config";
import { MountainSeekerV2State } from "./state/mountain-seeker-v2-state";
import { ATRIndicator } from "../indicators/atr-indicator";


/**
 * Mountain Seeker V2.
 * The general idea is to enter a trade when previous candle increased by a big amount.
 */
@injectable()
export class MountainSeekerV2 implements BaseStrategy {
    /** If a loss of -7% or less is reached it means that something went wrong and we abort everything */
    private static MAX_LOSS_TO_ABORT_EXECUTION = -7;

    private strategyDetails: StrategyDetails<any> | undefined;
    private markets: Array<Market> = [];
    private account: any;
    private initialWalletBalance?: Map<string, number>;
    private state: MountainSeekerV2State;
    private config: MountainSeekerV2Config & BaseStrategyConfig = { maxMoneyToTrade: -1 };
    private market?: Market;
    private latestSellStopLimitOrder?: Order;
    private amountOfTargetAssetThatWasBought?: number;
    private takeProfitATR?: number;
    private ATR?: number;
    private maxVariation?: number;
    private edgeVariation?: number;
    private volumeRatio?: number;

    constructor(private configService: ConfigService,
        private cryptoExchangePlatform: BinanceConnector,
        private emailService: EmailService,
        private binanceDataService: BinanceDataService,
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
        this.strategyDetails = { ...strategyDetails };
        this.config = { ...strategyDetails.config };
        this.initDefaultConfig(this.strategyDetails);
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
            this.config.authorizedCurrencies = [Currency.BUSD];
        }
        if (!strategyDetails.config.activeCandleStickIntervals) {
            const configFor15min: TradingLoopConfig = {
                secondsToSleepAfterTheBuy: 900,
                decisionMinutes: [15, 30, 45, 0], // [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 0]
                stopTradingMaxPercentLoss: -5
            };
            this.config.activeCandleStickIntervals = new Map([
                [CandlestickInterval.FIFTEEN_MINUTES, configFor15min]
            ]);
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.config.minimumPercentFor24hVariation = -1000;
        }
        // if (!strategyDetails.config.privilegedMarkets) {
        //     // sorted by order of preference
        //     this.config.privilegedMarkets = Array.from(marketConfigMapFor1min!.keys());
        // }
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
        this.state.last5CandleSticks = getCandleSticksByInterval(this.market, this.state.selectedCandleStickInterval!).slice(-5);
        log.info("Selected market %O", this.market.symbol);

        // 2. Fetch wallet balance and compute amount of BUSD to invest
        await this.getInitialBalance([Currency.BUSD.toString(), this.market.targetAsset]);
        const availableBusdAmount = this.initialWalletBalance?.get(Currency.BUSD.toString());
        const currentMarketPrice = await this.cryptoExchangePlatform.getUnitPrice(Currency.BUSD, this.market.targetAsset, false, 5)
            .catch(e => Promise.reject(e));
        const usdtAmountToInvest = this.computeAmountToInvest(availableBusdAmount!,
            ((this.market.maxPosition! - this.initialWalletBalance!.get(this.market.targetAsset)!) * currentMarketPrice));

        // 3. First BUY MARKET order to buy market.targetAsset
        const buyOrder = await this.createFirstMarketBuyOrder(usdtAmountToInvest, currentMarketPrice).catch(e => Promise.reject(e));
        this.amountOfTargetAssetThatWasBought = buyOrder.filled;
        const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!;
        this.emailService.sendInitialEmail(this.strategyDetails!, this.market, buyOrder.amountOfOriginAsset!, buyOrder.average, this.initialWalletBalance!,
            tradingLoopConfig.stopTradingMaxPercentLoss).then().catch(e => log.error(e));

        // 4. Stop loss
        this.state.stopLossPrice = GlobalUtils.decreaseNumberByPercent(buyOrder.average, tradingLoopConfig.stopTradingMaxPercentLoss);
        const stopLossOrder = await this.cryptoExchangePlatform.createStopLimitOrder(this.market.originAsset, this.market.targetAsset,
            "sell", buyOrder.filled, this.state.stopLossPrice, this.state.stopLossPrice, 5).catch(e => Promise.reject(e));

        // 5. Sleep
        await GlobalUtils.sleep(tradingLoopConfig.secondsToSleepAfterTheBuy);

        // 6. Finishing
        return await this.handleTradeEnd(buyOrder, stopLossOrder).catch(e => Promise.reject(e));
    }

    // /**
    //  * Monitors the current market price and creates new stop limit orders if price increases.
    //  */
    // private async runTradingLoop(buyOrder: Order, sellStopLimitOrder: Order, targetAssetAmount: number): Promise<{
    //     lastOrder: Order,
    //     shouldCancelStopLimitOrder: boolean
    // }> {
    //     const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!;
    //     let tempStopLossPrice = this.state.stopLossPrice!;
    //     let lastOrder = sellStopLimitOrder;
    //     let worstCaseProfit;
    //     let marketUnitPrice = Infinity;
    //     this.state.runUp = -Infinity;
    //     this.state.drawDown = Infinity;
    //     let priceChange;
    //     let shouldCancelStopLimitOrder = true;
    //     const marketConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!
    //         .marketConfig.get(this.state.selectedCandleStickInterval! === CandlestickInterval.FIFTEEN_MINUTES ? this.market!.symbol : "DEFAULT")!;
    //
    //     while (this.state.stopLossPrice! < marketUnitPrice &&
    //         StrategyUtils.getPercentVariation(buyOrder.average, marketUnitPrice) > tradingLoopConfig.stopTradingMaxPercentLoss &&
    //         (marketUnitPrice === Infinity || (marketUnitPrice !== Infinity && marketUnitPrice < this.state.takeProfitPrice!))) {
    //         await GlobalUtils.sleep(tradingLoopConfig.secondsToSleepInTheTradingLoop);
    //
    //         if ((await this.cryptoExchangePlatform.orderIsClosed(lastOrder.externalId, lastOrder.originAsset, lastOrder.targetAsset,
    //             lastOrder.id, lastOrder.type!, 300).catch(e => Promise.reject(e)))) {
    //             log.debug(`Order ${lastOrder.id} is already closed`);
    //             shouldCancelStopLimitOrder = false;
    //             lastOrder = await this.cryptoExchangePlatform.getOrder(lastOrder.externalId, this.market!.originAsset, this.market!.targetAsset,
    //                 lastOrder.id, OrderType.STOP_LIMIT, 5).catch(e => Promise.reject(e));
    //             break;
    //         }
    //         marketUnitPrice = await this.cryptoExchangePlatform.getUnitPrice(this.market!.originAsset, this.market!.targetAsset, false, 10)
    //             .catch(e => Promise.reject(e));
    //
    //         // computing ATR and a new trailing stop loss based on the before last candlestick
    //         const updatedCandleSticks = await this.cryptoExchangePlatform.getCandlesticks(this.market!.symbol, this.state.selectedCandleStickInterval!,
    //             50, 5).catch(e => Promise.reject(e));
    //         const ATR = this.atrIndicator.compute(updatedCandleSticks, { period: marketConfig.atrPeriod }).result.reverse()[1];
    //         const stopLossATR = marketConfig.stopLossATRMultiplier * ATR;
    //         const close = StrategyUtils.getCandleStick(updatedCandleSticks, 1)[4];
    //
    //         if (this.eligibleToIncreaseStopPrice(close, stopLossATR, tempStopLossPrice, this.state.selectedCandleStickInterval!, new Date(buyOrder.datetime))) {
    //             tempStopLossPrice = GlobalUtils.truncateNumber(close - stopLossATR, this.market!.pricePrecision!);
    //             log.debug(`Updating stop loss price to : ${tempStopLossPrice}`);
    //             // cancel the previous sell limit order
    //             await this.cryptoExchangePlatform.cancelOrder(lastOrder.externalId, sellStopLimitOrder.id,
    //                 this.market!.originAsset, this.market!.targetAsset, 5).catch(e => Promise.reject(e));
    //
    //             // create new sell stop limit order
    //             lastOrder = await this.cryptoExchangePlatform.createStopLimitOrder(this.market!.originAsset, this.market!.targetAsset,
    //                 "sell", targetAssetAmount, tempStopLossPrice, tempStopLossPrice, 3).catch(e => Promise.reject(e));
    //             this.latestSellStopLimitOrder = lastOrder;
    //             this.state.stopLossPrice = lastOrder.stopPrice!;
    //         }
    //         priceChange = Number(StrategyUtils.getPercentVariation(buyOrder.average, marketUnitPrice).toFixed(3));
    //         this.state.runUp = Math.max(this.state.runUp, priceChange);
    //         this.state.drawDown = Math.min(this.state.drawDown, priceChange);
    //
    //         worstCaseProfit = StrategyUtils.getPercentVariation(buyOrder.average, GlobalUtils.decreaseNumberByPercent(this.state.stopLossPrice!, 0.1));
    //         log.info(`Buy : ${buyOrder.average.toFixed(this.market?.pricePrecision)}, current : ${(marketUnitPrice)
    //             .toFixed(this.market?.pricePrecision)}, change % : ${priceChange}% | Sell : ${(this.state.stopLossPrice!).toFixed(this.market?.pricePrecision)} | Wanted profit : ${
    //             StrategyUtils.getPercentVariation(buyOrder.average, this.state.takeProfitPrice!).toFixed(3)}% | Worst case profit ≈ ${Math
    //             .max(Number(worstCaseProfit.toFixed(3)), tradingLoopConfig.stopTradingMaxPercentLoss)}%`);
    //     }
    //     return Promise.resolve({ lastOrder, shouldCancelStopLimitOrder });
    // }


    private async handleTradeEnd(firstBuyOrder: Order, stopLossOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder;
        completedOrder = await this.cryptoExchangePlatform.cancelOrder(stopLossOrder.externalId, stopLossOrder.id,
            stopLossOrder.originAsset, stopLossOrder.targetAsset, 3).catch(e => Promise.reject(e));
        if (completedOrder.status === "canceled") {
            completedOrder = await this.cryptoExchangePlatform.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                firstBuyOrder.filled, true, 5).catch(e => Promise.reject(e));
        }

        this.state.retrievedAmountOfBusd = completedOrder!.amountOfOriginAsset!;
        await this.handleRedeem();

        this.state.profitBusd = this.state.retrievedAmountOfBusd! - this.state.investedAmountOfBusd!;
        this.state.profitPercent = StrategyUtils.getPercentVariation(this.state.investedAmountOfBusd!, this.state.retrievedAmountOfBusd!);

        const endWalletBalance = await this.cryptoExchangePlatform.getBalance([Currency.BUSD.toString(), this.market!.targetAsset], 3, true)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendFinalMail(this.strategyDetails!, this.market!, firstBuyOrder.amountOfOriginAsset!, this.state.retrievedAmountOfBusd!,
            this.state.profitBusd, this.state.profitPercent, this.initialWalletBalance!, endWalletBalance,
            this.state.runUp!, this.state.drawDown!, this.strategyDetails!.type).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        // TODO remove atr
        this.ATR = this.atrIndicator.compute(this.market!.candleSticks.get(this.state.selectedCandleStickInterval!)!,
            { period: 14 }).result.reverse()[1];
        // TODO print full account object when api key/secret are moved to DB
        log.info(`Final percent change : ${this.state.profitPercent.toFixed(2)} | State : ${JSON
            .stringify(this.state)} | Account : ${JSON.stringify(this.account.email)} | Strategy : ${JSON.stringify(this.strategyDetails)} | Market : ${JSON
            .stringify(this.market)} | ATR : ${this.ATR.toFixed(4)} | maxVariation : ${this.maxVariation
            ?.toFixed(2)} | edgeVariation : ${this.edgeVariation?.toFixed(2)} | volumeRatio : ${this.volumeRatio}`);
        return Promise.resolve();
    }

    // /**
    //  * @return `true` if stop price can be increased
    //  */
    // private eligibleToIncreaseStopPrice(close: number, stopLossATR: number, tempStopLossPrice: number,
    //     candlestickInterval: CandlestickInterval, buyOrderDate: Date): boolean {
    //     if (!(GlobalUtils.truncateNumber(close - stopLossATR, this.market!.pricePrecision!) > tempStopLossPrice)) {
    //         return false;
    //     } else {
    //         log.debug("New potential stop loss %O is higher than %O", GlobalUtils.truncateNumber(close - stopLossATR, this.market!.pricePrecision!), tempStopLossPrice);
    //     }
    //     // this is to avoid to increase immediately the price when default candlestick interval is 5min
    //     // and for example the first buy order was done at 12h10
    //     if (candlestickInterval === CandlestickInterval.FIFTEEN_MINUTES) {
    //         const currentDate = GlobalUtils.getCurrentBelgianDate();
    //         const currentMinute = currentDate.getMinutes();
    //         // can only update stop loss on specific time intervals and if at least 1 minute passed with
    //         // the initial buy order
    //         const res = (currentMinute < 5 || (currentMinute >= 15 && currentMinute < 20) ||
    //                 (currentMinute >= 30 && currentMinute < 35) || (currentMinute >= 45 && currentMinute < 50)) &&
    //             (Math.abs((currentDate.getTime() - buyOrderDate.getTime())) / 1000) > 60;
    //         log.debug("eligibleToIncreaseStopPrice will return %O", res);
    //         return res;
    //     }
    //     return true;
    // }


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
                    log.debug(`Local redeem order object : ${redeemOrder} , retrievedAmountOfBusd : ${this.state.retrievedAmountOfBusd}`);
                    if (this.state.retrievedAmountOfBusd !== undefined && this.state.retrievedAmountOfBusd !== 0) {
                        this.state.retrievedAmountOfBusd += redeemOrder.amount;
                    } else {
                        this.state.retrievedAmountOfBusd = redeemOrder.amount;
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
            buyOrder = await this.cryptoExchangePlatform.createMarketBuyOrder(this.market!.originAsset, this.market!.targetAsset,
                usdtAmountToInvest, true, retries).catch(e => Promise.reject(e));
        } else {
            buyOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset, this.market!.targetAsset,
                "buy", usdtAmountToInvest / currentMarketPrice, true, retries, usdtAmountToInvest, this.market!.amountPrecision)
                .catch(e => Promise.reject(e));
        }
        this.state.investedAmountOfBusd = buyOrder.amountOfOriginAsset;
        return buyOrder;
    }

    /**
     * Searches the best market based on some criteria.
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private async selectMarketForTrading(markets: Array<Market>): Promise<Market | undefined> {
        const potentialMarkets: Array<{market: Market, interval: CandlestickInterval, takeProfitATR: number, stopLossPrice: number,
            maxVariation: number, edgeVariation: number, volumeRatio: number}> = [];
        for (const market of markets) {
            for (const interval of _.intersection(market.candleStickIntervals,
                Array.from(this.config.activeCandleStickIntervals!.keys()))) {
                switch (interval) {
                case CandlestickInterval.FIVE_MINUTES:
                    this.selectMarketBy5MinutesCandleSticks(market, potentialMarkets);
                    break;
                case CandlestickInterval.FIFTEEN_MINUTES:
                    this.selectMarketBy15MinutesCandleSticks(market, potentialMarkets);
                    break;
                default:
                    return Promise.reject(`Unable to select a market due to unknown or unhandled candlestick interval : ${interval}`);
                }
            }
        }

        if (potentialMarkets.length === 0) {
            return Promise.resolve(undefined);
        }

        if (potentialMarkets.length > 0) {
            this.state.selectedCandleStickInterval = potentialMarkets[0].interval;
            this.maxVariation = potentialMarkets[0].maxVariation;
            this.edgeVariation = potentialMarkets[0].edgeVariation;
            this.volumeRatio = potentialMarkets[0].volumeRatio;
            // this.state.stopLossPrice = potentialMarkets[0].stopLossPrice;
            return Promise.resolve(potentialMarkets[0].market);
        }
    }

    // private selectMarketBy1MinuteCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval,
    //     takeProfitATR: number, stopLossPrice: number}>) {
    //
    //     // should wait at least 1 hour for consecutive trades on same market
    //     const lastTradeDate = this.config.marketLastTradeDate!.get(market.symbol);
    //     if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
    //         return;
    //     }
    //
    //     const marketConfig = this.config.activeCandleStickIntervals!.get(CandlestickInterval.ONE_MINUTE)!
    //         .marketConfig.get("DEFAULT")!;
    //     const beforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(market.candleSticksPercentageVariations
    //         .get(CandlestickInterval.ONE_MINUTE)!, 1);
    //
    //     // if before last candle percent change is below minimal threshold
    //     if (beforeLastCandlestickPercentVariation < marketConfig.minCandlePercentChange!) {
    //         return;
    //     }
    //
    //     // if before last candle percent change is above maximal threshold
    //     if (beforeLastCandlestickPercentVariation > marketConfig.maxCandlePercentChange!) {
    //         return;
    //     }
    //
    //     const allVariations = market.candleSticksPercentageVariations.get(CandlestickInterval.ONE_MINUTE)!;
    //     // if 1 of 30 variations except the 2 latest are > than threshold
    //     const threshold = 3;
    //     let selectedVariations = allVariations.slice(allVariations.length - (30 + 2), -2);
    //     if (selectedVariations.some(variation => Math.abs(variation) > threshold)) {
    //         return;
    //     }
    //
    //     // if 1 of 50 variations except the 2 latest are == 0
    //     selectedVariations = allVariations.slice(allVariations.length - (50 + 2), -2);
    //     if (selectedVariations.some(variation => variation == 0)) {
    //         return;
    //     }
    //
    //     const beforeLastCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_MINUTE)!, 1);
    //     // if % difference between close and the high of the before last candle is too big
    //     if (StrategyUtils.getPercentVariation(beforeLastCandle[4], beforeLastCandle[2]) > 0.2) {
    //         return;
    //     }
    //
    //
    //     // // if the line is not +/- horizontal
    //     // const twentienthCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!, 21);
    //     // const beforeBeforeLastCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!, 2);
    //     // if (StrategyUtils.getPercentVariation(twentienthCandle[4], beforeBeforeLastCandle[4]) > 5 ||
    //     //     StrategyUtils.getPercentVariation(twentienthCandle[4], beforeBeforeLastCandle[4]) < -4) {
    //     //     return;
    //     // }
    //     //
    //     // // in the twenty candles there is no a pair of close prices with a difference of more than 3.3%
    //     // let selectedTwentyCandlesticks = market.candleSticks.get(CandlestickInterval.ONE_HOUR)!;
    //     // selectedTwentyCandlesticks = selectedTwentyCandlesticks.slice(selectedTwentyCandlesticks.length - 22, -2);
    //     // for (let i = 0; i < selectedTwentyCandlesticks.length; i++) {
    //     //     for (let j = selectedTwentyCandlesticks.length - 1; j !== i; j--) {
    //     //         if (Math.abs(StrategyUtils.getPercentVariation(selectedTwentyCandlesticks[i][4], selectedTwentyCandlesticks[j][4])) > 3.3) {
    //     //             return;
    //     //         }
    //     //     }
    //     // }
    //
    //     // const lastCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!, 0);
    //     // const beforeLastCandle = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!, 1);
    //
    //     // // if current price is much lover than previous close
    //     // if (StrategyUtils.getPercentVariation(beforeLastCandle[4], lastCandle[4]) < -0.5) {
    //     //     return;
    //     // }
    //
    //     // // if variation between close and high is too big
    //     // if (StrategyUtils.getPercentVariation(beforeLastCandle[4], beforeLastCandle[4]) > 2) {
    //     //     return;
    //     // }
    //
    //     // const macdResult = this.macdIndicator.compute(market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!);
    //     // if (!macdResult.shouldBuy) {
    //     //     return;
    //     // }
    //     //
    //     // const ATR = this.atrIndicator.compute(market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!,
    //     //     { period: marketConfig.atrPeriod }).result.reverse()[1];
    //     // const stopLossATR = marketConfig.stopLossATRMultiplier * ATR;
    //     // const takeProfitATR = marketConfig.takeProfitATRMultiplier * ATR;
    //     // const beforeLastCandlestick = StrategyUtils.getCandleStick(market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!, 1);
    //     // const close = beforeLastCandlestick[4];
    //     //
    //     // let stopLossPrice = close - stopLossATR;
    //     // const maxStopLoss = close * (1 - (Math.abs(this.config.activeCandleStickIntervals!
    //     //     .get(CandlestickInterval.FIVE_MINUTES)!.stopTradingMaxPercentLoss) / 100));
    //     // if (stopLossPrice < maxStopLoss) {
    //     //     // TODO: or return?
    //     //     // stopLossATR = close - maxStopLoss;
    //     //     log.debug("Using max stop loss %O", maxStopLoss);
    //     //     stopLossPrice = maxStopLoss;
    //     // }
    //     // log.debug("Using stop loss %O", stopLossPrice);
    //
    //     log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.ONE_MINUTE);
    //     potentialMarkets.push({ market, interval: CandlestickInterval.ONE_MINUTE, takeProfitATR: 0, stopLossPrice: 0 });
    // }

    private selectMarketBy15MinutesCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval,
        takeProfitATR: number, stopLossPrice: number, maxVariation: number, edgeVariation: number, volumeRatio: number}>) {
        const shouldAddResult = this.shouldSelectMarketBy15MinutesCandleSticks(market, market.candleSticks.get(CandlestickInterval.FIFTEEN_MINUTES)!,
            market.candleSticksPercentageVariations.get(CandlestickInterval.FIFTEEN_MINUTES)!);
        if (shouldAddResult.shouldAdd) {
            const candleSticksExceptLast = [...market.candleSticks.get(CandlestickInterval.FIFTEEN_MINUTES)!];
            candleSticksExceptLast.pop();
            const candleSticksPercentageVariationsExceptLast = [...market.candleSticksPercentageVariations.get(CandlestickInterval.FIFTEEN_MINUTES)!];
            candleSticksPercentageVariationsExceptLast.pop();
            const previousShouldAdd = this.shouldSelectMarketBy15MinutesCandleSticks(market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            if (!previousShouldAdd.shouldAdd) {
                log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.FIFTEEN_MINUTES);
                potentialMarkets.push({ market, interval: CandlestickInterval.FIFTEEN_MINUTES, takeProfitATR: 0, stopLossPrice: 0,
                    maxVariation: shouldAddResult.maxVariation!, edgeVariation: shouldAddResult.edgeVariation!,
                    volumeRatio: shouldAddResult.volumeRatio! });
            }
        }
    }

    private shouldSelectMarketBy15MinutesCandleSticks(market: Market, candleSticks: Array<TOHLCV>,
        candleSticksPercentageVariations: Array<number>): { shouldAdd: boolean, maxVariation?: number,
        edgeVariation?: number, volumeRatio?: number } {
        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = this.config.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return { shouldAdd: false };
        }

        // should be in some range
        if (market.percentChangeLast24h! < -3 || market.percentChangeLast24h! > 25) {
            return { shouldAdd: false };
        }

        // should make a decision at fixed minutes
        const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(CandlestickInterval.FIFTEEN_MINUTES)!;
        const minuteOfLastCandlestick = new Date(StrategyUtils.getCandleStick(candleSticks, 0)[0]).getMinutes();
        const currentMinute = new Date().getMinutes();
        if (tradingLoopConfig.decisionMinutes.indexOf(minuteOfLastCandlestick) === -1 ||
            (tradingLoopConfig.decisionMinutes.indexOf(currentMinute) === -1 &&
                tradingLoopConfig.decisionMinutes.indexOf(currentMinute - 1) === -1)) {
            return { shouldAdd: false };
        }

        const beforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 1);

        // if before last candle percent change is below minimal threshold
        if (beforeLastCandlestickPercentVariation < 2) {
            return { shouldAdd: false };
        }

        // if before last candle percent change is above maximal threshold
        if (beforeLastCandlestickPercentVariation > 13) {
            return { shouldAdd: false };
        }

        const beforeBeforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 2);

        // if before before last candle percent change is below minimal threshold
        if (beforeBeforeLastCandlestickPercentVariation < 2) {
            return { shouldAdd: false };
        }

        // if before before last candle percent change is above maximal threshold
        if (beforeBeforeLastCandlestickPercentVariation > 10) {
            return { shouldAdd: false };
        }

        const allCandlesticks = candleSticks;
        const thirtyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 30 - 3, -3);

        // if c2 close > c3..30 high
        const beforeBeforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 2);
        if (thirtyCandlesticks.some(candle => candle[2] > beforeBeforeLastCandle[4])) {
            return { shouldAdd: false };
        }

        // v1 must be >= 1.7 * v2..30
        const beforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 1);
        if (beforeLastCandle[5] < 1.7 * beforeBeforeLastCandle[5] ||
            thirtyCandlesticks.some(candle => beforeLastCandle[5] < 1.7 * candle[5])) {
            return { shouldAdd: false };
        }

        // const allVariations = market.candleSticksPercentageVariations.get(CandlestickInterval.FIFTEEN_MINUTES)!;
        // // if 1 of 30 variations except the 3 latest are > than threshold
        // const threshold = 3;
        // const thirtyVariations = allVariations.slice(allVariations.length - 30 + 3, -3);
        // if (thirtyVariations.some(variation => Math.abs(variation) > threshold)) {
        //     return;
        // }

        // if the line is not +/- horizontal
        const twentyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 20 - 6, -6); // except the last 6
        const highestOpen = twentyCandlesticks.map(candle => candle[1])
            .reduce((prev, current) => (prev > current ? prev : current));
        const highestClose = twentyCandlesticks.map(candle => candle[4])
            .reduce((prev, current) => (prev > current ? prev : current));
        const highest = Math.max(highestOpen, highestClose);
        const lowestOpen = twentyCandlesticks.map(candle => candle[1])
            .reduce((prev, current) => (prev < current ? prev : current));
        const lowestClose = twentyCandlesticks.map(candle => candle[4])
            .reduce((prev, current) => (prev < current ? prev : current));
        const lowest = Math.min(lowestOpen, lowestClose);
        // the variation of the 20 candlesticks should not be bigger than 5%
        const maxVariation = Math.abs(StrategyUtils.getPercentVariation(highest, lowest));
        // if (maxVariation > 5) {
        //     return;
        // }
        // the variation of the first and last in the 20 candlesticks should not be bigger than 5% // TODO 5 or 3?
        const edgeVariation = Math.abs(StrategyUtils.getPercentVariation(twentyCandlesticks[0][4],
            twentyCandlesticks[twentyCandlesticks.length - 1][4]));
        // if (edgeVariation > 5) {
        //     return;
        // }
        return { shouldAdd: true, maxVariation, edgeVariation, volumeRatio: beforeLastCandle[5] / beforeBeforeLastCandle[5] };
    }

    private selectMarketBy5MinutesCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval,
        takeProfitATR: number, stopLossPrice: number, maxVariation: number, edgeVariation: number, volumeRatio: number}>) {
        const shouldAddResult = this.shouldSelectMarketBy5MinutesCandleSticks(market, market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!,
            market.candleSticksPercentageVariations.get(CandlestickInterval.FIVE_MINUTES)!);
        if (shouldAddResult.shouldAdd) {
            const candleSticksExceptLast = [...market.candleSticks.get(CandlestickInterval.FIVE_MINUTES)!];
            candleSticksExceptLast.pop();
            const candleSticksPercentageVariationsExceptLast = [...market.candleSticksPercentageVariations.get(CandlestickInterval.FIVE_MINUTES)!];
            candleSticksPercentageVariationsExceptLast.pop();
            const previousShouldAdd = this.shouldSelectMarketBy5MinutesCandleSticks(market, candleSticksExceptLast, candleSticksPercentageVariationsExceptLast);
            if (!previousShouldAdd.shouldAdd) {
                log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.FIVE_MINUTES);
                potentialMarkets.push({ market, interval: CandlestickInterval.FIVE_MINUTES, takeProfitATR: 0, stopLossPrice: 0,
                    maxVariation: shouldAddResult.maxVariation!, edgeVariation: shouldAddResult.edgeVariation!,
                    volumeRatio: shouldAddResult.volumeRatio! });
            }
        }
    }

    private shouldSelectMarketBy5MinutesCandleSticks(market: Market, candleSticks: Array<TOHLCV>,
        candleSticksPercentageVariations: Array<number>): { shouldAdd: boolean, maxVariation?: number,
        edgeVariation?: number, volumeRatio?: number } {
        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = this.config.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return { shouldAdd: false };
        }

        // should be in some range
        if (market.percentChangeLast24h! < -3 || market.percentChangeLast24h! > 25) {
            return { shouldAdd: false };
        }

        // should make a decision at fixed minutes
        const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(CandlestickInterval.FIVE_MINUTES)!;
        const minuteOfLastCandlestick = new Date(StrategyUtils.getCandleStick(candleSticks, 0)[0]).getMinutes();
        const currentMinute = new Date().getMinutes();
        if (tradingLoopConfig.decisionMinutes.indexOf(minuteOfLastCandlestick) === -1 ||
            (tradingLoopConfig.decisionMinutes.indexOf(currentMinute) === -1 &&
            tradingLoopConfig.decisionMinutes.indexOf(currentMinute - 1) === -1)) {
            return { shouldAdd: false };
        }

        const beforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 1);

        // if before last candle percent change is below minimal threshold
        if (beforeLastCandlestickPercentVariation < 1.4) {
            return { shouldAdd: false };
        }

        // if before last candle percent change is above maximal threshold
        if (beforeLastCandlestickPercentVariation > 7) {
            return { shouldAdd: false };
        }

        const beforeBeforeLastCandlestickPercentVariation = StrategyUtils.getCandleStickPercentageVariation(candleSticksPercentageVariations, 2);

        // if before before last candle percent change is below minimal threshold
        if (beforeBeforeLastCandlestickPercentVariation < 1.4) {
            return { shouldAdd: false };
        }

        // if before before last candle percent change is above maximal threshold
        if (beforeBeforeLastCandlestickPercentVariation > 7) {
            return { shouldAdd: false };
        }

        const allCandlesticks = candleSticks;
        const twentyFiveCandlesticks = allCandlesticks.slice(allCandlesticks.length - 25 - 3, -3); // except the last 3

        // if c2 close > c3..25 high
        const beforeBeforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 2);
        if (twentyFiveCandlesticks.some(candle => candle[2] > beforeBeforeLastCandle[4])) {
            return { shouldAdd: false };
        }

        // v1 must be >= 1.7 * v2..25
        const beforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 1);
        if (beforeLastCandle[5] < 1.7 * beforeBeforeLastCandle[5] ||
            twentyFiveCandlesticks.some(candle => beforeLastCandle[5] < 1.7 * candle[5])) {
            return { shouldAdd: false };
        }

        // if the line is not +/- horizontal
        const twentyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 20 - 6, -6); // except the last 6
        const highestOpen = twentyCandlesticks.map(candle => candle[1])
            .reduce((prev, current) => (prev > current ? prev : current));
        const highestClose = twentyCandlesticks.map(candle => candle[4])
            .reduce((prev, current) => (prev > current ? prev : current));
        const highest = Math.max(highestOpen, highestClose);
        const lowestOpen = twentyCandlesticks.map(candle => candle[1])
            .reduce((prev, current) => (prev < current ? prev : current));
        const lowestClose = twentyCandlesticks.map(candle => candle[4])
            .reduce((prev, current) => (prev < current ? prev : current));
        const lowest = Math.min(lowestOpen, lowestClose);
        // the variation of the 20 candlesticks should not be bigger than 5%
        const maxVariation = Math.abs(StrategyUtils.getPercentVariation(highest, lowest));
        if (maxVariation > 5) {
            return { shouldAdd: false };
        }
        // the variation of the first and last in the 20 candlesticks should not be bigger than 5% // TODO 5 or 3?
        const edgeVariation = Math.abs(StrategyUtils.getPercentVariation(twentyCandlesticks[0][4],
            twentyCandlesticks[twentyCandlesticks.length - 1][4]));
        if (edgeVariation > 5) {
            return { shouldAdd: false };
        }
        return { shouldAdd: true, maxVariation, edgeVariation, volumeRatio: beforeLastCandle[5] / beforeBeforeLastCandle[5] };
    }


    /**
     * @return All potentially interesting markets after filtering based on various criteria
     */
    private getFilteredMarkets(): Array<Market> {
        this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, this.config.authorizedCurrencies);
        this.markets = StrategyUtils.filterByIgnoredMarkets(this.markets, this.config.ignoredMarkets);
        // this.markets = StrategyUtils.filterByMinimumTradingVolume(this.markets, 100000);
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
     * @return The amount of {@link Currency.BUSD} that will be invested (the minimum between the available
     * and the max money to trade)
     */
    private computeAmountToInvest(availableAmountOfBusd: number, maxAmountToBuy: number): number {
        return Math.min(availableAmountOfBusd, this.config.maxMoneyToTrade, maxAmountToBuy);
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

        if (this.amountOfTargetAssetThatWasBought !== undefined && this.amountOfTargetAssetThatWasBought !== 0) {
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