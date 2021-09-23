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
import { MACDIndicator } from "../indicators/macd-indicator";


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
    private marketUnitPriceOfOriginAssetInEur = -1;
    private initialWalletBalance?: Map<string, number>;
    private state: SqueezeState;
    private config: SqueezeConfig & BaseStrategyConfig = { maxMoneyToTrade: -1 };
    /** If a loss of -7% or less is reached it means that something went wrong and we abort everything */
    private static MAX_LOSS_TO_ABORT_EXECUTION = -7;


    constructor(private configService: ConfigService,
        private cryptoExchangePlatform: BinanceConnector,
        private emailService: EmailService,
        private binanceDataService: BinanceDataService,
        private macdIndicator: MACDIndicator) {
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
        }
    }

    /**
     * Set default config values
     */
    private initDefaultConfig(strategyDetails: StrategyDetails<SqueezeConfig>) {
        this.config.marketLastTradeDate = new Map<string, Date>();
        if (!strategyDetails.config.authorizedCurrencies) {
            this.config.authorizedCurrencies = [Currency.EUR];
        }
        if (!strategyDetails.config.activeCandleStickIntervals) {
            const configFor1h: TradingLoopConfig = {
                secondsToSleepInTheTradingLoop: 300, // 5 min
                trailPricePercent: 1.0,
                stopTradingMaxPercentLoss: -5
            };
            this.config.activeCandleStickIntervals = new Map([[CandlestickInterval.ONE_HOUR, configFor1h]]);
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.config.minimumPercentFor24hVariation = -10;
        }
        if (!strategyDetails.config.authorizedMarkets) {
            this.config.authorizedMarkets = [];
        }
        if (!strategyDetails.config.minimumTradingVolumeLast24h) {
            this.config.minimumTradingVolumeLast24h = 100;
        }
    }

    public async run(): Promise<void> {
        // 1. Filter and select market
        this.markets = this.getFilteredMarkets();
        const market = await this.selectMarketForTrading(this.markets).catch(e => Promise.reject(e));

        if (!market) {
            if (this.configService.isSimulation()) {
                log.info("No market was found"); // best log this only in simulation mode to not pollute the logs
            }
            return Promise.resolve();
        }

        log.debug(`Using config : ${JSON.stringify(this.strategyDetails)}`);
        this.state.marketSymbol = market.symbol;
        this.cryptoExchangePlatform.setMarketMinNotional(market);
        this.cryptoExchangePlatform.printMarketDetails(market);
        this.state.marketPercentChangeLast24h = market.percentChangeLast24h;
        this.state.candleSticksPercentageVariations = getCandleSticksPercentageVariationsByInterval(market, this.state.selectedCandleStickInterval!);
        log.info("Found market %O", market.symbol);
        this.emailService.sendEmail(`Trading started on ${market.symbol}`,
            "Current state : \n" + JSON.stringify(this.state, GlobalUtils.replacer, 4) +
            "\n\nMarket details : \n" + JSON.stringify(market, GlobalUtils.replacer, 4)).then().catch(e => log.error(e));

        // 2. Fetch wallet balance and compute amount of EUR to invest
        await this.getInitialBalance([Currency.EUR.toString(), market.targetAsset]);
        const availableEurAmount = this.initialWalletBalance?.get(Currency.EUR.toString());
        const eurAmountToInvest = this.computeAmountToInvest(market, availableEurAmount!);

        // 3. First MARKET BUY order to buy market.targetAsset
        log.debug("Preparing to execute the first buy order on %O market to invest %O€", market.symbol, eurAmountToInvest);
        const buyOrder = await this.cryptoExchangePlatform.createMarketBuyOrder(market.originAsset, market.targetAsset,
            eurAmountToInvest, true, 5).catch(e => Promise.reject(e));
        this.state.investedAmountOfEuro = buyOrder.amountOfOriginAsset;

        // 4. First LIMIT SELL order
        const limitPrice = GlobalUtils.decreaseNumberByPercent(buyOrder.average,
            this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!.stopTradingMaxPercentLoss);
        const firstSellLimitOrder = await this.cryptoExchangePlatform.createLimitSellOrder(market.originAsset, market.targetAsset,
            buyOrder.filled, limitPrice, 5).catch(e => Promise.reject(e)); // TODO : shall we not sell everything that is in the wallet instead?

        // 5. Start price monitor loop
        const lastSellLimitOrder = await this.runTradingLoop(buyOrder, limitPrice, firstSellLimitOrder, market,
            buyOrder.filled).catch(e => Promise.reject(e));

        // 6. Finishing
        return await this.handleTradeEnd(market, lastSellLimitOrder, buyOrder).catch(e => Promise.reject(e));
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, limitPrice: number, sellLimitOrder: Order, market: Market,
        targetAssetAmount: number): Promise<Order> {
        let newSellLimitPrice = buyOrder.average;
        const tradingLoopConfig = this.config.activeCandleStickIntervals!.get(this.state.selectedCandleStickInterval!)!;
        let tempTrailPrice = 0;
        let lastSellLimitOrder = sellLimitOrder;
        let potentialProfit;
        let marketUnitPrice = Infinity;

        while (limitPrice < marketUnitPrice) {
            await GlobalUtils.sleep(tradingLoopConfig.secondsToSleepInTheTradingLoop);
            if ((await this.cryptoExchangePlatform.orderIsClosed(lastSellLimitOrder.externalId, lastSellLimitOrder.originAsset, lastSellLimitOrder.targetAsset,
                lastSellLimitOrder.id, lastSellLimitOrder.type!, 300).catch(e => Promise.reject(e)))) {
                break;
            }
            marketUnitPrice = await this.cryptoExchangePlatform.getUnitPrice(market.originAsset, market.targetAsset, false, 10)
                .catch(e => Promise.reject(e));

            tempTrailPrice = GlobalUtils.decreaseNumberByPercent(marketUnitPrice, tradingLoopConfig.trailPricePercent);
            if (tempTrailPrice > newSellLimitPrice && tempTrailPrice > GlobalUtils.increaseNumberByPercent(buyOrder.average, 0.1)) {
                // cancel the previous sell limit order
                await this.cryptoExchangePlatform.cancelOrder(lastSellLimitOrder.externalId, sellLimitOrder.id,
                    market.originAsset, market.targetAsset).catch(e => Promise.reject(e));

                // update sell limit price
                newSellLimitPrice = tempTrailPrice;

                // create new sell limit order
                lastSellLimitOrder = await this.cryptoExchangePlatform.createLimitSellOrder(market.originAsset, market.targetAsset,
                    targetAssetAmount, newSellLimitPrice, 3).catch(e => Promise.reject(e));
            }
            this.state.pricePercentChangeOnYEur = Number(StrategyUtils.getPercentVariation(buyOrder.average, marketUnitPrice).toFixed(3));
            potentialProfit = StrategyUtils.getPercentVariation(buyOrder.average, newSellLimitPrice);
            log.info(`Buy : ${buyOrder.average}, current : ${(marketUnitPrice)
                .toFixed(8)}, change % : ${this.state.pricePercentChangeOnYEur}% | Sell price : ${limitPrice
                .toFixed(8)} | Potential profit : ${potentialProfit.toFixed(3)}%`);
        }
        return Promise.resolve(lastSellLimitOrder);
    }

    /**
     * If the initial selected market was not accepting EUR (e.g. "CAKE/BNB")
     * then the full amount of origin asset is traded for EUR (e.g. => BNB is sold on "BNB/EUR" market)
     */
    private async handleTradeEnd(market: Market, lastStopLimitOrder: Order, buyOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder = await this.cryptoExchangePlatform.waitForOrderCompletion(lastStopLimitOrder, market.originAsset,
            market.targetAsset, 3).catch(e => Promise.reject(e));
        if (!completedOrder) { // LIMIT order took too long => use a MARKET order
            await this.cryptoExchangePlatform.cancelOrder(lastStopLimitOrder.externalId, lastStopLimitOrder.id,
                lastStopLimitOrder.originAsset, lastStopLimitOrder.targetAsset).catch(e => Promise.reject(e));
            completedOrder = await this.cryptoExchangePlatform.createMarketSellOrder(market.originAsset, market.targetAsset,
                lastStopLimitOrder.amountOfTargetAsset, true, 5).catch(e => Promise.reject(e));
        }

        this.state.retrievedAmountOfEuro = completedOrder!.amountOfOriginAsset!;
        await this.convertRemainingTargetAssetToBNB(market); // TODO : is this needed?
        this.state.profitEuro = this.state.retrievedAmountOfEuro! - this.state.investedAmountOfEuro!;
        this.state.profitPercent = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro!);

        const endWalletBalance = await this.cryptoExchangePlatform.getBalance([Currency.EUR.toString(), market.targetAsset])
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendEmail(`Trading finished on ${market.symbol} (${this.state.profitPercent > 0
            ? '+' : ''}${this.state.profitPercent.toFixed(2)}%, ${this.state.profitEuro.toFixed(2)}€)`, "Final state is : \n" +
            JSON.stringify(this.state, GlobalUtils.replacer, 4)).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        log.info(`Final percent change : ${this.state.profitPercent} | Final state : ${JSON.stringify(this.state)}`);
        return Promise.resolve();
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

        const oneHourMarket = StrategyUtils.highestBy24hVariation(potentialMarkets.filter(market => market.interval === CandlestickInterval.ONE_HOUR));
        if (oneHourMarket) {
            this.state.selectedCandleStickInterval = CandlestickInterval.ONE_HOUR;
            return Promise.resolve(oneHourMarket);
        }

        // by default, take the first market
        this.state.selectedCandleStickInterval = potentialMarkets[0].interval;
        return Promise.resolve(potentialMarkets[0].market);
    }

    private selectMarketByOneHourCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>) {
        const candleStickPercentVariations = getCandleSticksPercentageVariationsByInterval(market, CandlestickInterval.ONE_HOUR);

        // should wait at least 1 hour for consecutive trades on same market
        const lastTradeDate = this.config.marketLastTradeDate!.get(market.symbol);
        if (lastTradeDate && (Math.abs(lastTradeDate.getTime() - new Date().getTime()) / 3.6e6) <= 1) {
            return;
        }

        // if MACD indicator on 1h candlesticks thinks it's better not to buy
        if (!this.macdIndicator.compute(market.candleSticks.get(CandlestickInterval.ONE_HOUR)!).shouldBuy) {
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
        this.markets = StrategyUtils.filterByMinimumTradingVolume(this.markets, this.config.minimumTradingVolumeLast24h);
        this.markets = StrategyUtils.filterByIgnoredMarkets(this.markets, this.config.ignoredMarkets);
        this.markets = StrategyUtils.filterByAuthorizedMarkets(this.markets, this.config.authorizedMarkets);
        this.markets = StrategyUtils.filterByAmountPrecision(this.markets, 1); // when trading with big price amounts, this can maybe be removed
        return this.markets;
    }


    /**
     * Tries to convert the remaining {@link market.targetAsset} into {@link Currency.BNB} in order to compute the total equivalent of the converted
     * {@link Currency.BNB} in EUR of and add the result to {@link this.state.retrievedAmountOfEuro}.
     * If the conversion is not possible, then computes the EUR equivalent of
     * {@link market.targetAsset} and adds it to {@link this.state.retrievedAmountOfEuro}.
     */
    private async convertRemainingTargetAssetToBNB(market: Market): Promise<void> {
        const walletBalance = await this.cryptoExchangePlatform.getBalance([Currency.BNB, market.targetAsset])
            .catch(e => Promise.reject(e));
        if (walletBalance.get(market.targetAsset)! > 0) {
            const success = await this.cryptoExchangePlatform.convertSmallAmountsToBNB([market.targetAsset]);
            if (!success) {
                return;
            }

            const finalBNBAmount = await this.cryptoExchangePlatform.getBalanceForAsset(Currency.BNB).catch(e => Promise.reject(e));

            if (!this.state.retrievedAmountOfEuro) {
                this.state.retrievedAmountOfEuro = 0;
            }

            const initialBNBAmount = walletBalance.get(Currency.BNB)!;
            if (initialBNBAmount === finalBNBAmount) {
                log.warn(`Was unable to convert ${walletBalance.get(market.targetAsset)}${market.targetAsset} to ${Currency.BNB}`);
                const priceOfTargetAssetInOriginAsset = await this.cryptoExchangePlatform.getUnitPrice(market.originAsset, market.targetAsset, true, 10)
                    .catch(e => Promise.reject(e));
                const priceOfOriginAssetInEUR = await this.cryptoExchangePlatform.getUnitPrice(Currency.EUR, market.originAsset, true, 10)
                    .catch(e => Promise.reject(e));
                const equivalentInEUR = walletBalance.get(market.targetAsset)! * priceOfTargetAssetInOriginAsset * priceOfOriginAssetInEUR;
                log.debug(`Remaining ${walletBalance.get(market.targetAsset)!}${market.targetAsset} equals to ${equivalentInEUR}€`);
                this.state.retrievedAmountOfEuro += equivalentInEUR;
            } else {
                const priceOfBNBInEUR = await this.cryptoExchangePlatform.getUnitPrice(Currency.EUR, Currency.BNB, true, 10)
                    .catch(e => Promise.reject(e));
                this.state.profitBNB = finalBNBAmount - initialBNBAmount;
                const equivalentInEUR = priceOfBNBInEUR * this.state.profitBNB;
                log.debug(`Converted ${this.state.profitBNB}${Currency.BNB} equals to ${equivalentInEUR}€`);
                this.state.retrievedAmountOfEuro += equivalentInEUR; // TODO : think if it's good to do that
            }
        }
    }

    /**
     * Fetches wallet information
     */
    private async getInitialBalance(assets: Array<string>): Promise<void> {
        this.initialWalletBalance = await this.cryptoExchangePlatform.getBalance(assets)
            .catch(e => Promise.reject(e));
        this.state.initialWalletBalance = JSON.stringify(Array.from(this.initialWalletBalance!.entries()));
        log.info("Initial wallet balance : %O", this.initialWalletBalance);
        return Promise.resolve();
    }

    /**
     * @return The amount of {@link Currency.EUR} that will be invested (the minimum between the available and the max money to trade)
     */
    private computeAmountToInvest(market: Market, availableAmountOfEur: number): number {
        return Math.min(availableAmountOfEur, this.config.maxMoneyToTrade);
    }
}