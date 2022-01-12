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
import { NumberUtils } from "../utils/number-utils";


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
    private account: Account = { email: '' };
    private initialWalletBalance?: Map<string, number>;
    private state: MountainSeekerV2State = { id: uuidv4() };
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
                await this.emailService.sendEmail("Trading stopped...", JSON.stringify({
                    error: error.message,
                    account: this.account.email,
                    strategyDetails: this.strategyDetails,
                    config: this.config
                }, GlobalUtils.replacer, 4));
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
                secondsToSleepAfterTheBuy: 900, // 15min
                decisionMinutes: [15, 30, 45, 0], // [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 0]
                stopTradingMaxPercentLoss: -4.8
            };
            this.config.activeCandleStickIntervals = new Map([
                [CandlestickInterval.FIFTEEN_MINUTES, configFor15min]
            ]);
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.config.minimumPercentFor24hVariation = -1000;
        }
    }

    public async run(): Promise<void> {
        // 1. Filter and select market
        this.markets = this.getFilteredMarkets();
        this.market = await this.selectMarketForTrading(this.markets).catch(e => Promise.reject(e));

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
        const stopLossPrice = NumberUtils.decreaseNumberByPercent(buyOrder.average, tradingLoopConfig.stopTradingMaxPercentLoss);
        this.latestSellStopLimitOrder = await this.cryptoExchangePlatform.createStopLimitOrder(this.market.originAsset, this.market.targetAsset,
            "sell", buyOrder.filled, stopLossPrice, stopLossPrice, 5, this.config.simulation).catch(e => Promise.reject(e));

        // 5. Sleep
        await this.runTradingLoop(buyOrder, this.latestSellStopLimitOrder!, tradingLoopConfig);

        // 6. Finishing
        return await this.handleTradeEnd(buyOrder, this.latestSellStopLimitOrder!).catch(e => Promise.reject(e));
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, lastOrder: Order, tradingLoopConfig: TradingLoopConfig): Promise<void> {
        let marketUnitPrice = Infinity;
        this.state.runUp = -Infinity;
        this.state.drawDown = Infinity;
        let priceChange;
        const priceWatchInterval = 5; // in seconds
        const endTradingDate = GlobalUtils.getCurrentBelgianDate();
        endTradingDate.setSeconds(endTradingDate.getSeconds() + tradingLoopConfig.secondsToSleepAfterTheBuy)

        while (GlobalUtils.getCurrentBelgianDate() < endTradingDate) {
            await GlobalUtils.sleep(priceWatchInterval);

            if ((await this.cryptoExchangePlatform.orderIsClosed(lastOrder.externalId, lastOrder.originAsset, lastOrder.targetAsset,
                lastOrder.id, lastOrder.type!, 5, undefined, this.config.simulation).catch(e => Promise.reject(e)))) {
                log.debug(`Order ${lastOrder.id} is already closed`);
                break;
            }

            marketUnitPrice = await this.cryptoExchangePlatform.getUnitPrice(this.market!.originAsset, this.market!.targetAsset, false, 10)
                .catch(e => Promise.reject(e));

            priceChange = Number(NumberUtils.getPercentVariation(buyOrder.average, marketUnitPrice).toFixed(3));
            this.state.runUp = Math.max(this.state.runUp, priceChange);
            this.state.drawDown = Math.min(this.state.drawDown, priceChange);

            if (marketUnitPrice < lastOrder.stopPrice!) {
                // if price dropped below stop loss order price and the stop loss order is still open
                log.debug(`Price change is too low ${priceChange}% ! Stop price is ${lastOrder.stopPrice!} while the current is ${marketUnitPrice}`);
                break;
            }
        }
        return Promise.resolve();
    }


    private async handleTradeEnd(firstBuyOrder: Order, stopLossOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder;
        completedOrder = await this.cryptoExchangePlatform.cancelOrder(stopLossOrder.externalId, stopLossOrder.id,
            stopLossOrder.originAsset, stopLossOrder.targetAsset, 3, this.config.simulation).catch(e => Promise.reject(e));
        if (completedOrder.status === "canceled") {
            completedOrder = await this.cryptoExchangePlatform.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                firstBuyOrder.filled, true, 5, undefined, this.config.simulation).catch(e => Promise.reject(e));
        }

        this.state.retrievedAmountOfBusd = completedOrder!.amountOfOriginAsset!;
        await this.handleRedeem(); // TODO shouldn't we filter BLVT?

        this.state.profitMoney = Number((this.state.retrievedAmountOfBusd! - this.state.investedAmountOfBusd!).toFixed(2));
        this.state.profitPercent = Number(NumberUtils.getPercentVariation(this.state.investedAmountOfBusd!, this.state.retrievedAmountOfBusd!).toFixed(2));

        const endWalletBalance = await this.cryptoExchangePlatform.getBalance([Currency.BUSD.toString(), this.market!.targetAsset], 3, true)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendFinalMail(this.strategyDetails!, this.market!, firstBuyOrder.amountOfOriginAsset!, this.state.retrievedAmountOfBusd!,
            this.state.profitMoney, this.state.profitPercent, this.initialWalletBalance!, endWalletBalance,
            this.state.runUp!, this.state.drawDown!, this.strategyDetails!.type).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        // TODO remove atr
        this.ATR = this.atrIndicator.compute(this.market!.candleSticks.get(this.state.selectedCandleStickInterval!)!,
            { period: 14 }).result.reverse()[1];
        // TODO print full account object when api key/secret are moved to DB
        const finalLog = `Final percent change : ${this.state.profitPercent}
            | State : ${JSON.stringify(this.state)}
            | Account : ${JSON.stringify(this.account.email)} 
            | Strategy : ${JSON.stringify(this.strategyDetails)}
            | Market : ${JSON.stringify(this.market)}
            | ATR : ${this.ATR.toFixed(4)}
            | maxVariation : ${this.maxVariation?.toFixed(2)}
            | edgeVariation : ${this.edgeVariation?.toFixed(2)} 
            | volumeRatio : ${this.volumeRatio?.toFixed(2)}
            |`;
        log.info(finalLog.replace(/(\r\n|\n|\r)/gm, ""));
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
     * Otherwise, it will compute the equivalent amount of target asset and make a different buy order.
     */
    private async createFirstMarketBuyOrder(moneyAmountToInvest: number, currentMarketPrice: number): Promise<Order> {
        let buyOrder;
        const retries = 5;
        if (this.market!.quoteOrderQtyMarketAllowed) {
            buyOrder = await this.cryptoExchangePlatform.createMarketBuyOrder(this.market!.originAsset, this.market!.targetAsset,
                moneyAmountToInvest, true, retries, this.config.simulation).catch(e => Promise.reject(e));
        } else {
            buyOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset, this.market!.targetAsset,
                "buy", moneyAmountToInvest / currentMarketPrice, true, retries, moneyAmountToInvest,
                this.market!.amountPrecision, this.config.simulation)
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
        if (this.configService.isSimulation()) {
            this.state.selectedCandleStickInterval = CandlestickInterval.FIFTEEN_MINUTES;
            return Promise.resolve(this.markets[0]);
        }
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
            return Promise.resolve(potentialMarkets[0].market);
        }
    }

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
        let twentyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 20 - 3, -3);

        // if c2 close > c3..20 high
        const beforeBeforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 2);
        if (twentyCandlesticks.some(candle => candle[2] > beforeBeforeLastCandle[4])) {
            return { shouldAdd: false };
        }

        // v1 must be >= 1.7 * v2..20
        const beforeLastCandle = StrategyUtils.getCandleStick(candleSticks, 1);
        if (beforeLastCandle[5] < 1.7 * beforeBeforeLastCandle[5] ||
            twentyCandlesticks.some(candle => beforeLastCandle[5] < 1.7 * candle[5])) {
            return { shouldAdd: false };
        }

        // if the line is not +/- horizontal
        twentyCandlesticks = allCandlesticks.slice(allCandlesticks.length - 20 - 6, -6); // except the last 6
        // the variation of the 20 candlesticks should not be bigger than 5%
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticks);
        // if (maxVariation > 5) {
        //     return;
        // }
        // the variation of the first and last in the 20 candlesticks should not be bigger than 5% // TODO 5 or 3?
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticks[0][4],
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
        const maxVariation = StrategyUtils.getMaxVariation(twentyCandlesticks);
        // the variation of the 20 candlesticks should not be bigger than 5%
        if (maxVariation > 5) {
            return { shouldAdd: false };
        }
        // the variation of the first and last in the 20 candlesticks should not be bigger than 5% // TODO 5 or 3?
        const edgeVariation = Math.abs(NumberUtils.getPercentVariation(twentyCandlesticks[0][4],
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
                    this.amountOfTargetAssetThatWasBought = NumberUtils.decreaseNumberByPercent(
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