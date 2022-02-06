import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { BinanceConnector } from "../api-connectors/binance-connector";
import { getCandleSticksByInterval, getCandleSticksPercentageVariationsByInterval, Market } from "../models/market";
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
import { MarketSelector } from "./marketselector/msv2/market-selector";
import { SelectorResult } from "./marketselector/selector.interface";

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
    private account: Account = { email: '', maxMoneyAmount: 0, mailPreferences: {} };
    private initialWalletBalance?: Map<string, number>;
    private state: MountainSeekerV2State = { id: "" };
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
        private binanceConnector: BinanceConnector,
        private emailService: EmailService,
        private binanceDataService: BinanceDataService,
        private atrIndicator: ATRIndicator,
        private marketSelector: MarketSelector) {
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
        this.binanceConnector.setup(account);
        this.strategyDetails = { ...strategyDetails };
        this.config = { ...strategyDetails.config };
        this.initDefaultConfig(this.strategyDetails);
        this.binanceDataService.registerObserver(this);
        return this;
    }

    async update(markets: Array<Market>, sessionID: string): Promise<void> {
        if (!this.state.marketSymbol) { // if there is no active trading
            this.markets = markets;
            this.state.id = sessionID;
            try {
                await this.run();
                this.prepareForNextTrade();
            } catch (e) {
                await this.abort();
                this.binanceDataService.removeObserver(this);
                const error = new Error(e as any);
                log.error(`Trading was aborted due to an error: ${e}. Stacktrace: ${(e as any).stack}`);
                await this.emailService.sendEmail("Trading stopped...", JSON.stringify({
                    error: error.message,
                    account: this.account.email,
                    strategyDetails: this.strategyDetails,
                    uniqueID: this.state.id
                }, GlobalUtils.replacer, 4));
            }
        }
    }

    private prepareForNextTrade(): void {
        if (this.state.marketSymbol) {
            const profit = this.state.profitPercent;
            if (!this.config.simulation! && profit && profit <= MountainSeekerV2.MAX_LOSS_TO_ABORT_EXECUTION) {
                throw new Error(`Aborting due to a big loss: ${this.state.profitPercent}%`);
            }
            if (!this.config.simulation! &&
                profit! + this.state.profitOfPreviousTrade! <= MountainSeekerV2.MAX_LOSS_TO_ABORT_EXECUTION) {
                throw new Error(`Aborting due to a big loss during last two trades. Previous: ${this.state.profitOfPreviousTrade}%, current: ${profit}%`);
            }
            if (!this.config.autoRestart) {
                this.binanceDataService.removeObserver(this);
                return;
            }
            this.state.marketLastTradeDate!.set(this.state.marketSymbol, new Date());
            this.state = { id: "", profitOfPreviousTrade: profit, marketLastTradeDate: this.state.marketLastTradeDate }; // resetting the state after a trade
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
        this.state.marketLastTradeDate = new Map<string, Date>();
        this.state.profitOfPreviousTrade = 0;
        if (!strategyDetails.config.authorizedCurrencies) {
            this.config.authorizedCurrencies = [Currency.BUSD];
        }
        if (!strategyDetails.config.activeCandleStickIntervals) {
            const configFor15min: TradingLoopConfig = {
                secondsToSleepAfterTheBuy: 900, // 15min
                decisionMinutes: [15, 30, 45, 0],
                stopTradingMaxPercentLoss: -4.8,
                priceWatchInterval: 5
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
        this.printMarketDetails(this.market);
        this.state.marketPercentChangeLast24h = this.market.percentChangeLast24h;
        this.state.last5CandleSticksPercentageVariations = getCandleSticksPercentageVariationsByInterval(this.market,
            this.state.selectedCandleStickInterval!).slice(-5);
        this.state.last5CandleSticks = getCandleSticksByInterval(this.market, this.state.selectedCandleStickInterval!).slice(-5);
        log.info("Selected market %O", this.market.symbol);

        // 2. Fetch wallet balance and compute amount of BUSD to invest
        await this.getInitialBalance([Currency.BUSD.toString(), this.market.targetAsset]);
        const availableBusdAmount = this.initialWalletBalance?.get(Currency.BUSD.toString());
        const busdAmountToInvest = this.computeAmountToInvest(availableBusdAmount!);

        // 3. First BUY MARKET order to buy market.targetAsset
        const buyOrder = await this.createFirstMarketBuyOrder(busdAmountToInvest).catch(e => Promise.reject(e));
        this.amountOfTargetAssetThatWasBought = buyOrder.filled;
        const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!;
        this.emailService.sendInitialEmail(this.account, this.strategyDetails!, this.state, this.market, buyOrder.amountOfOriginAsset!, buyOrder.average,
            this.initialWalletBalance!).then().catch(e => log.error(e));

        // 4. Stop loss
        const stopLossPrice = NumberUtils.decreaseNumberByPercent(buyOrder.average, tradingLoopConfig.stopTradingMaxPercentLoss);
        this.latestSellStopLimitOrder = await this.binanceConnector.createStopLimitOrder(this.market.originAsset, this.market.targetAsset,
            "sell", buyOrder.filled, stopLossPrice, stopLossPrice, 5, this.config.simulation).catch(e => Promise.reject(e));

        // 5. Sleep
        await this.runTradingLoop(buyOrder, this.latestSellStopLimitOrder!, tradingLoopConfig);

        // 6. Finishing
        return this.handleTradeEnd(buyOrder, this.latestSellStopLimitOrder!).catch(e => Promise.reject(e));
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, lastOrder: Order, tradingLoopConfig: TradingLoopConfig): Promise<void> {
        let marketUnitPrice = Infinity;
        this.state.runUp = -Infinity;
        this.state.drawDown = Infinity;
        let priceChange;
        const endTradingDate = GlobalUtils.getCurrentBelgianDate();
        endTradingDate.setSeconds(endTradingDate.getSeconds() + tradingLoopConfig.secondsToSleepAfterTheBuy)

        while (GlobalUtils.getCurrentBelgianDate() < endTradingDate) {
            await GlobalUtils.sleep(tradingLoopConfig.priceWatchInterval);

            if ((await this.binanceConnector.orderIsClosed(lastOrder.externalId, lastOrder.originAsset, lastOrder.targetAsset,
                lastOrder.id, lastOrder.type!, 5, undefined, this.config.simulation).catch(e => Promise.reject(e)))) {
                log.debug(`Order ${lastOrder.id} is already closed`);
                break;
            }

            marketUnitPrice = await this.binanceConnector.getUnitPrice(this.market!.originAsset, this.market!.targetAsset, this.configService.isSimulation(), 10)
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
        completedOrder = await this.binanceConnector.cancelOrder(stopLossOrder.externalId, stopLossOrder.id,
            stopLossOrder.originAsset, stopLossOrder.targetAsset, 3, this.config.simulation).catch(e => Promise.reject(e));
        if (completedOrder.status === "canceled") {
            completedOrder = await this.binanceConnector.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                firstBuyOrder.filled, true, 5, undefined, this.config.simulation).catch(e => Promise.reject(e));
        }

        this.state.retrievedAmountOfBusd = completedOrder!.amountOfOriginAsset!;
        this.state.profitMoney = Number((this.state.retrievedAmountOfBusd! - this.state.investedAmountOfBusd!).toFixed(2));
        this.state.profitPercent = Number(NumberUtils.getPercentVariation(this.state.investedAmountOfBusd!, this.state.retrievedAmountOfBusd!).toFixed(2));

        const endWalletBalance = await this.binanceConnector.getBalance([Currency.BUSD.toString(), this.market!.targetAsset], 3, true)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendFinalMail(this.account, this.strategyDetails!, this.state, this.market!,
            firstBuyOrder.amountOfOriginAsset!, completedOrder, this.initialWalletBalance!, endWalletBalance).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        // TODO remove atr
        this.ATR = this.atrIndicator.compute(this.market!.candleSticks.get(this.state.selectedCandleStickInterval!)!,
            { period: 14 }).result.reverse()[1];
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
        log.info(finalLog.replace(/(\r\n|\n|\r)/gm, "")); // so that it is printed on a single line in CloudWatch
        return Promise.resolve();
    }

    /**
     * If the market accepts quote price then it will create a BUY MARKET order by specifying how much we want to spend.
     */
    private async createFirstMarketBuyOrder(moneyAmountToInvest: number): Promise<Order> {
        if (!this.market!.quoteOrderQtyMarketAllowed) {
            // normally this should ever happen on non BLVT markets
            // but if this happens in future we could for example use this.binanceConnector.createMarketOrder()
            const errorMessage = `quoteOrderQtyMarketAllowed is not supported on market ${this.market?.symbol}`;
            log.error(errorMessage);
            return Promise.reject(errorMessage);
        }
        const buyOrder = await this.binanceConnector.createMarketBuyOrder(this.market!.originAsset, this.market!.targetAsset,
            moneyAmountToInvest, true, 5, this.config.simulation).catch(e => Promise.reject(e));
        this.state.investedAmountOfBusd = buyOrder.amountOfOriginAsset;
        return buyOrder;
    }

    /**
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private async selectMarketForTrading(markets: Array<Market>): Promise<Market | undefined> {
        if (this.configService.isSimulation()) {
            this.state.selectedCandleStickInterval = Array.from(this.config.activeCandleStickIntervals!.keys())[0];
            return this.markets[0];
        }
        const potentialMarkets: Array<SelectorResult> = [];
        for (const market of markets) {
            for (const interval of _.intersection(market.candleStickIntervals,
                Array.from(this.config.activeCandleStickIntervals!.keys()))) {
                const selectorResult = this.marketSelector.isMarketEligible(this.config, this.state, market, interval);
                if (selectorResult) {
                    log.debug("Added potential market %O with interval %O", market.symbol, interval);
                    potentialMarkets.push(selectorResult);
                }
            }
        }

        if (potentialMarkets.length === 0) {
            return undefined;
        }

        // TODO select the best among the found ones
        const marketWithLowestVariation = potentialMarkets.reduce((prev, current) =>
            (prev.maxVariation! < current.maxVariation! ? prev : current));

        this.state.selectedCandleStickInterval = marketWithLowestVariation.interval;
        this.maxVariation = marketWithLowestVariation.maxVariation;
        this.edgeVariation = marketWithLowestVariation.edgeVariation;
        this.volumeRatio = marketWithLowestVariation.volumeRatio;
        // TODO add :  this.strategyDetails?.customName = marketWithLowestVariation. ...
        return marketWithLowestVariation.market;
    }

    /**
     * @return All potentially interesting markets after filtering based on various criteria
     */
    private getFilteredMarkets(): Array<Market> {
        this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, this.config.authorizedCurrencies);
        this.markets = StrategyUtils.filterByIgnoredMarkets(this.markets, this.config.ignoredMarkets);
        this.markets = StrategyUtils.filterBLVT(this.markets);
        this.markets = StrategyUtils.filterByAmountPrecision(this.markets, 1); // when trading with big price amounts, this can maybe be removed
        return this.markets;
    }

    /**
     * Fetches wallet information
     */
    private async getInitialBalance(assets: Array<string>): Promise<void> {
        this.initialWalletBalance = await this.binanceConnector.getBalance(assets, 3)
            .catch(e => Promise.reject(e));
        this.state.initialWalletBalance = JSON.stringify(Array.from(this.initialWalletBalance!.entries()));
        log.info("Initial wallet balance : %O", this.initialWalletBalance);
        return Promise.resolve();
    }

    /**
     * @return The amount of {@link Currency.BUSD} that will be invested (the minimum between the available
     * and the max money to trade)
     */
    private computeAmountToInvest(availableAmountOfBusd: number): number {
        return Math.min(availableAmountOfBusd, this.config.maxMoneyToTrade, this.account.maxMoneyAmount);
    }

    /**
     * First tries to cancel the stop limit order and then tries to sell {@link Market.targetAsset}
     */
    private async abort(): Promise<void> {
        if (this.latestSellStopLimitOrder && this.latestSellStopLimitOrder.externalId) {
            log.debug(`Aborting - cancelling order ${JSON.stringify(this.latestSellStopLimitOrder)}`);
            try {
                await this.binanceConnector.cancelOrder(this.latestSellStopLimitOrder?.externalId,
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
                sellMarketOrder = await this.binanceConnector.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                    this.amountOfTargetAssetThatWasBought, true, 3,
                    undefined, this.config.simulation);
            } catch (e) {
                log.error(`Error while creating market sell order : ${JSON.stringify(e)}`);
            }

            if (!sellMarketOrder) {
                for (const percent of [0.05, 0.5, 1, 2]) {
                    const decreasedAmount = NumberUtils.decreaseNumberByPercent(
                        this.amountOfTargetAssetThatWasBought, percent);
                    try {
                        sellMarketOrder = await this.binanceConnector.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                            decreasedAmount, true, 3,
                            undefined, this.config.simulation);
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

    private printMarketDetails(market: Market) {
        try {
            log.debug(`Market details from local object : ${JSON.stringify(market)}`);
            log.debug(`Market details from binance : ${JSON.stringify(this.binanceDataService.getBinanceMarketDetails(market))}`);
        } catch (e) {
            log.warn(`Failed to get market details ${e}`);
        }
    }
}