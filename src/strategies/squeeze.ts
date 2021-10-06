import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { SqueezeState } from "./state/squeeze-state";
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
import { SqueezeConfig, TradingLoopConfig } from "./config/squeeze-config";
import { SqueezeIndicator } from "../indicators/squeeze-indicator";
import assert from "assert";


/**
 * Strategy based on squeeze momentum indicator.
 *
 * See the indicator here : {@link https://www.tradingview.com/v/nqQ1DT5a/}
 */
@injectable()
export class Squeeze implements BaseStrategy {
    /* eslint-disable  @typescript-eslint/no-explicit-any */
    private strategyDetails: any;
    private markets: Array<Market> = [];
    private account: Account = {};
    private initialWalletBalance?: Map<string, number>;
    private state: SqueezeState;
    private config: SqueezeConfig & BaseStrategyConfig = { maxMoneyToTrade: -1 };
    /** If a loss of -7% or less is reached it means that something went wrong and we abort everything */
    private static MAX_LOSS_TO_ABORT_EXECUTION = -7;
    private market?: Market;
    private latestSellStopLimitOrder?: Order;
    private amountOfTargetAssetThatWasBought?: number;

    constructor(private configService: ConfigService,
        private cryptoExchangePlatform: BinanceConnector,
        private emailService: EmailService,
        private binanceDataService: BinanceDataService,
        private squeezeIndicator: SqueezeIndicator) {
        this.state = { id: uuidv4() };
        if (!this.configService.isSimulation() && process.env.NODE_ENV !== "prod") {
            log.warn("WARNING : this is not a simulation");
        }
    }

    getState(): SqueezeState {
        return this.state;
    }

    public setup(account: Account, strategyDetails: StrategyDetails<SqueezeConfig>): Squeeze {
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
            if (this.state.profitPercent && this.state.profitPercent <= Squeeze.MAX_LOSS_TO_ABORT_EXECUTION) {
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
        }
    }

    /**
     * Set default config values
     */
    private initDefaultConfig(strategyDetails: StrategyDetails<SqueezeConfig>) {
        this.config.marketLastTradeDate = new Map<string, Date>();
        if (!strategyDetails.config.authorizedCurrencies) {
            this.config.authorizedCurrencies = [Currency.USDT];
        }
        const trailingPricePercentMap = new Map();
        if (!strategyDetails.config.activeCandleStickIntervals) {
            trailingPricePercentMap.set("ADAUP/USDT", 0.5);
            trailingPricePercentMap.set("ADADOWN/USDT", 0.5);
            trailingPricePercentMap.set("BNBUP/USDT", 0.5);
            trailingPricePercentMap.set("BNBDOWN/USDT", 0.5);
            trailingPricePercentMap.set("EOSUP/USDT", 0.5);
            trailingPricePercentMap.set("EOSDOWN/USDT", 0.5);
            trailingPricePercentMap.set("ETHUP/USDT", 0.5);
            trailingPricePercentMap.set("ETHDOWN/USDT", 0.5);
            const configFor1h: TradingLoopConfig = {
                initialSecondsToSleepInTheTradingLoop: 3, // 3 sec
                secondsToSleepInTheTradingLoop: 300, // 5 min
                trailPricePercent: trailingPricePercentMap,
                stopTradingMaxPercentLoss: -5
            };
            this.config.activeCandleStickIntervals = new Map([[CandlestickInterval.ONE_HOUR, configFor1h]]);
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.config.minimumPercentFor24hVariation = -1000;
        }
        if (!strategyDetails.config.authorizedMarkets) {
            // sorted by order of preference
            this.config.authorizedMarkets = Array.from(trailingPricePercentMap!.keys());
        }

        // each authorised market must be defined in trailPricePercent map
        strategyDetails.config.authorizedMarkets!.forEach(marketSymbol =>
            assert(this.config.activeCandleStickIntervals?.get(CandlestickInterval.ONE_HOUR)!
                .trailPricePercent.get(marketSymbol) !== undefined), "Something is not correct in the configuration");
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
        this.state.candleSticksPercentageVariations = getCandleSticksPercentageVariationsByInterval(this.market, this.state.selectedCandleStickInterval!);
        log.info("Found market %O", this.market.symbol);
        this.emailService.sendEmail(`Trading started on ${this.market.symbol}`,
            "Current state : \n" + JSON.stringify(this.state, GlobalUtils.replacer, 4) +
            "\n\nMarket details : \n" + JSON.stringify(this.market, GlobalUtils.replacer, 4)).then().catch(e => log.error(e));

        // 2. Fetch wallet balance and compute amount of USDT to invest
        await this.getInitialBalance([Currency.USDT.toString(), this.market.targetAsset]);
        const availableUsdtAmount = this.initialWalletBalance?.get(Currency.USDT.toString());
        const currentMarketPrice = this.market.candleSticks.get(CandlestickInterval.ONE_HOUR)!.reverse()[0][4]; // = close price of last candlestick
        const usdtAmountToInvest = this.computeAmountToInvest(availableUsdtAmount!,
            ((this.market.maxPosition! - this.initialWalletBalance!.get(this.market.targetAsset)!) * currentMarketPrice));

        // 3. First BUY MARKET order to buy market.targetAsset
        const buyOrder = await this.createFirstMarketBuyOrder(this.market, usdtAmountToInvest, currentMarketPrice)
            .catch(e => Promise.reject(e));
        this.amountOfTargetAssetThatWasBought = buyOrder.filled;

        // 4. First SELL STOP LIMIT order (default: -5%)
        let stopLimitPrice = GlobalUtils.decreaseNumberByPercent(buyOrder.average,
            this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!.stopTradingMaxPercentLoss);
        stopLimitPrice = GlobalUtils.truncateNumber(stopLimitPrice, this.market.pricePrecision!);

        const firstSellStopLimitOrder = await this.cryptoExchangePlatform.createStopLimitOrder(this.market.originAsset, this.market.targetAsset,
            "sell", buyOrder.filled, stopLimitPrice, stopLimitPrice, 5).catch(e => Promise.reject(e));
        this.latestSellStopLimitOrder = firstSellStopLimitOrder;

        // 5. Start price monitor loop
        const lastSellStopLimitOrder = await this.runTradingLoop(buyOrder, stopLimitPrice, firstSellStopLimitOrder, this.market,
            buyOrder.filled).catch(e => Promise.reject(e));

        // 6. Finishing
        return await this.handleTradeEnd(this.market, lastSellStopLimitOrder).catch(e => Promise.reject(e));
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, stopLimitPrice: number, sellStopLimitOrder: Order, market: Market,
        targetAssetAmount: number): Promise<Order> {
        let newSellStopLimitPrice = Number(buyOrder.average.toFixed(this.market?.pricePrecision));
        const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!;
        let tempTrailPrice = stopLimitPrice;
        let lastSellStopLimitOrder = sellStopLimitOrder;
        let potentialProfit;
        let firstTrailPriceSet = false;
        let marketUnitPrice = Infinity;
        this.state.runUp = -Infinity;
        this.state.drawDown = Infinity;
        let priceChange;

        while (tempTrailPrice < marketUnitPrice) {
            if (firstTrailPriceSet) {
                // if first trailing limit is set, wait longer
                await GlobalUtils.sleep(tradingLoopConfig.secondsToSleepInTheTradingLoop);
            } else {
                await GlobalUtils.sleep(tradingLoopConfig.initialSecondsToSleepInTheTradingLoop);
            }

            if ((await this.cryptoExchangePlatform.orderIsClosed(lastSellStopLimitOrder.externalId, lastSellStopLimitOrder.originAsset, lastSellStopLimitOrder.targetAsset,
                lastSellStopLimitOrder.id, lastSellStopLimitOrder.type!, 300).catch(e => Promise.reject(e)))) {
                break;
            }
            marketUnitPrice = await this.cryptoExchangePlatform.getUnitPrice(market.originAsset, market.targetAsset, false, 10)
                .catch(e => Promise.reject(e));

            tempTrailPrice = GlobalUtils.decreaseNumberByPercent(marketUnitPrice, tradingLoopConfig.trailPricePercent.get(market.symbol)!);
            tempTrailPrice = Number(tempTrailPrice.toFixed(this.market?.pricePrecision));
            if (tempTrailPrice > newSellStopLimitPrice && tempTrailPrice > GlobalUtils.increaseNumberByPercent(buyOrder.average, 0.2)) {
                firstTrailPriceSet = true;
                // cancel the previous sell limit order
                await this.cryptoExchangePlatform.cancelOrder(lastSellStopLimitOrder.externalId, sellStopLimitOrder.id,
                    market.originAsset, market.targetAsset).catch(e => Promise.reject(e));

                // update sell stop limit price
                newSellStopLimitPrice = tempTrailPrice;

                // create new sell stop limit order
                lastSellStopLimitOrder = await this.cryptoExchangePlatform.createStopLimitOrder(market.originAsset, market.targetAsset,
                    "sell", targetAssetAmount, newSellStopLimitPrice, newSellStopLimitPrice, 3).catch(e => Promise.reject(e));
                this.latestSellStopLimitOrder = lastSellStopLimitOrder;
                newSellStopLimitPrice = lastSellStopLimitOrder.limitPrice!;
            }
            priceChange = Number(StrategyUtils.getPercentVariation(buyOrder.average, marketUnitPrice).toFixed(3));
            this.state.runUp = Math.max(this.state.runUp, priceChange);
            this.state.drawDown = Math.min(this.state.drawDown, priceChange);

            potentialProfit = StrategyUtils.getPercentVariation(buyOrder.average, newSellStopLimitPrice);
            log.info(`Buy : ${buyOrder.average.toFixed(this.market?.pricePrecision)}, current : ${(marketUnitPrice)
                .toFixed(this.market?.pricePrecision)}, change % : ${priceChange}% | Sell : ${newSellStopLimitPrice
                .toFixed(this.market?.pricePrecision)} | Potential profit : ${potentialProfit.toFixed(3)}%`);
        }
        return Promise.resolve(lastSellStopLimitOrder);
    }

    private async handleTradeEnd(market: Market, lastStopLimitOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder = await this.cryptoExchangePlatform.waitForOrderCompletion(lastStopLimitOrder, market.originAsset,
            market.targetAsset, 3).catch(e => Promise.reject(e));
        if (!completedOrder) { // LIMIT order took too long => use a MARKET order
            await this.cryptoExchangePlatform.cancelOrder(lastStopLimitOrder.externalId, lastStopLimitOrder.id,
                lastStopLimitOrder.originAsset, lastStopLimitOrder.targetAsset).catch(e => Promise.reject(e));
            completedOrder = await this.cryptoExchangePlatform.createMarketSellOrder(market.originAsset, market.targetAsset,
                lastStopLimitOrder.amountOfTargetAsset, true, 5).catch(e => Promise.reject(e));
        }

        this.state.retrievedAmountOfUsdt = completedOrder!.amountOfOriginAsset!;
        await this.handleRedeem(market);

        this.state.profitUsdt = this.state.retrievedAmountOfUsdt! - this.state.investedAmountOfUsdt!;
        this.state.profitPercent = StrategyUtils.getPercentVariation(this.state.investedAmountOfUsdt!, this.state.retrievedAmountOfUsdt!);

        const endWalletBalance = await this.cryptoExchangePlatform.getBalance([Currency.USDT.toString(), market.targetAsset], 3)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendEmail(`Trading finished on ${market.symbol} (${this.state.profitPercent > 0
            ? '+' : ''}${this.state.profitPercent.toFixed(2)}%, ${this.state.profitUsdt.toFixed(2)}USDT)`, "Final state is : \n" +
            JSON.stringify(this.state, GlobalUtils.replacer, 4)).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        log.info(`Final percent change : ${this.state.profitPercent.toFixed(2)} | Final state : ${JSON.stringify(this.state)}`);
        return Promise.resolve();
    }

    /**
     * Sometimes Binance is not able to sell everything so in this method, if the market is BLVT,
     * we will try to sell the remaining amount. In order to add it to the profit
     */
    private async handleRedeem(market: Market): Promise<void> {
        if (!this.market?.quoteOrderQtyMarketAllowed) {
            const amountNotSold = await this.cryptoExchangePlatform.getBalanceForAsset(market.targetAsset);
            if (amountNotSold && amountNotSold > 0) {
                try {
                    const redeemOrder = await this.cryptoExchangePlatform.redeemBlvt(this.market!.targetAsset!, amountNotSold, 5);
                    if (this.state.retrievedAmountOfUsdt) {
                        this.state.retrievedAmountOfUsdt += redeemOrder.amount;
                    } else {
                        this.state.retrievedAmountOfUsdt = redeemOrder.amount;
                    }
                } catch (e) {
                    log.error(`Failed to redeem BLVT : ${JSON.stringify(e)}`)
                }
            }
        }
    }

    /**
     * If the market accepts quote price then it will create a BUY MARKET order by specifying how much we want to spend.
     * Otherwise it will compute the equivalent amount of target asset and make a different buy order.
     */
    private async createFirstMarketBuyOrder(market: Market, usdtAmountToInvest: number, currentMarketPrice: number): Promise<Order> {
        let buyOrder;
        const retries = 5;
        if (market.quoteOrderQtyMarketAllowed) {
            log.debug("Preparing to execute the first buy order on %O market to invest %OUSDT", market.symbol, usdtAmountToInvest);
            buyOrder = await this.cryptoExchangePlatform.createMarketBuyOrder(market.originAsset, market.targetAsset,
                usdtAmountToInvest, true, retries).catch(e => Promise.reject(e));
        } else {
            const amountToBuy = usdtAmountToInvest / currentMarketPrice;
            log.debug("Preparing to execute the first buy order on %O market to buy %O%O", market.symbol, amountToBuy, market.targetAsset);
            buyOrder = await this.cryptoExchangePlatform.createMarketOrder(market.originAsset, market.targetAsset,
                "buy", usdtAmountToInvest / currentMarketPrice, true, retries, usdtAmountToInvest, market.amountPrecision)
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
        const potentialMarkets: Array<{market: Market, interval: CandlestickInterval}> = [];
        for (const market of markets) {
            for (const interval of _.intersection(market.candleStickIntervals,
                Array.from(this.config.activeCandleStickIntervals!.keys()))) {
                switch (interval) {
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
        for (const marketSymbol of this.config.authorizedMarkets!) {
            if (potentialMarketSymbols.includes(marketSymbol)) {
                selectedMarket = potentialMarkets.filter(element => element.market.symbol === marketSymbol)[0];
                this.state.selectedCandleStickInterval = selectedMarket.interval;
                return Promise.resolve(selectedMarket.market);
            }
        }
    }

    private selectMarketByOneHourCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>) {
        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = this.config.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return;
        }

        // if Squeeze indicator on 1h candlesticks thinks it's better not to buy
        if (!this.squeezeIndicator.compute(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!).shouldBuy) {
            return;
        }

        log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.ONE_HOUR);
        potentialMarkets.push({ market, interval: CandlestickInterval.ONE_HOUR });
    }

    /**
     * @return All potentially interesting markets after filtering based on various criteria
     */
    private getFilteredMarkets(): Array<Market> {
        this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, this.config.authorizedCurrencies);
        this.markets = StrategyUtils.filterByIgnoredMarkets(this.markets, this.config.ignoredMarkets);
        this.markets = StrategyUtils.filterByAuthorizedMarkets(this.markets, this.config.authorizedMarkets);
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
                    this.latestSellStopLimitOrder.targetAsset);
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