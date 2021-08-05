import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
import { TradingState } from "../models/trading-state";
import { v4 as uuidv4 } from 'uuid';
import { BinanceConnector } from "../api-connectors/binance-connector";
import {
    getCandleStick,
    getCandleSticksByInterval,
    getCandleSticksPercentageVariationsByInterval,
    getCurrentCandleStickPercentageVariation,
    Market
} from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import { StrategyUtils } from "../utils/strategy-utils";
import { GlobalUtils } from "../utils/global-utils";
import { Order } from "../models/order";
import { EmailService } from "../services/email-service";
import { ConfigService } from "../services/config-service";
import { injectable } from "tsyringe";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";
import * as _ from "lodash";


/**
 * The general goal of this strategy is to select and buy an action
 * that is, and recently was, harshly rising in price.
 * Then sell it when the price starts to decrease.
 */
@injectable()
export class MountainSeeker implements BaseStrategy {
    private strategyDetails: any
    private account: Account | undefined;
    private marketUnitPriceOfOriginAssetInEur = -1;
    private initialWalletBalance?: Map<string, number>;
    private refilledWalletBalance?: Map<string, number>;
    private readonly state: TradingState;
    /** This interval is also used to construct other intervals (e.g. for 1h, 4h ...) */
    private readonly defaultCandleStickInterval = CandlestickInterval.THIRTY_MINUTES;
    /** Number of candlesticks that will be fetched from cryptocurrency trading platform */
    private readonly defaultNumberOfCandlesticks = 500;

    constructor(private configService: ConfigService,
        private cryptoExchangePlatform: BinanceConnector,
        private emailService: EmailService) {
        this.state = { id: uuidv4() };
        if (!this.configService.isSimulation() && process.env.NODE_ENV !== "prod") {
            log.warn("WARNING : this is not a simulation");
        }
    }

    public setup(account: Account, strategyDetails: StrategyDetails<MountainSeekerConfig>): MountainSeeker {
        this.account = account;
        this.strategyDetails = strategyDetails;
        this.initDefaultConfig(strategyDetails);
        this.state.config = strategyDetails;
        return this;
    }

    /**
     * Sets default config values
     * // TODO : there might be a better way to set default parameters
     */
    private initDefaultConfig(strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        if (!strategyDetails.config.authorizedCurrencies) {
            this.strategyDetails.config.authorizedCurrencies =
                [Currency.EUR, Currency.BTC, Currency.BNB, Currency.ETH];
        }
        if (!strategyDetails.config.actifCandleStickIntervals) {
            const configFor30m: TradingLoopConfig = {
                initialSecondsToSleepInTheTradingLoop: 60,
                initialStopLimitPriceIncreaseInTheTradingLoop: 0.1,
                initialStopLimitPriceTriggerPercent: 1.5,
                secondsToSleepInTheTradingLoop: 600,
                stopLimitPriceIncreaseInTheTradingLoop: 1.0,
                stopLimitPriceTriggerPercent: 3,
                stopTradingTimeoutSeconds: -1,
                stopTradingMaxPercentLoss: -10
            };
            const configFor4h: TradingLoopConfig = {
                initialSecondsToSleepInTheTradingLoop: 60,
                initialStopLimitPriceIncreaseInTheTradingLoop: 0.1,
                initialStopLimitPriceTriggerPercent: 1.5,
                secondsToSleepInTheTradingLoop: 600,
                stopLimitPriceIncreaseInTheTradingLoop: 1.0,
                stopLimitPriceTriggerPercent: 3,
                stopTradingTimeoutSeconds: -1,
                stopTradingMaxPercentLoss: -7
            };
            const configFor6h: TradingLoopConfig = {
                initialSecondsToSleepInTheTradingLoop: 60,
                initialStopLimitPriceIncreaseInTheTradingLoop: 0.1,
                initialStopLimitPriceTriggerPercent: 1.5,
                secondsToSleepInTheTradingLoop: 600,
                stopLimitPriceIncreaseInTheTradingLoop: 1.0,
                stopLimitPriceTriggerPercent: 3,
                stopTradingTimeoutSeconds: -1,
                stopTradingMaxPercentLoss: -7
            };
            this.strategyDetails.config.actifCandleStickIntervals = new Map([
                [CandlestickInterval.FOUR_HOURS, configFor4h],
                [CandlestickInterval.SIX_HOURS, configFor6h]]);
        }
        if (!strategyDetails.config.minimumPercentFor24hVariation) {
            this.strategyDetails.config.minimumPercentFor24hVariation = 1;
        }
        if (!strategyDetails.config.authorizedMarkets) {
            this.strategyDetails.config.authorizedMarkets = [];
        }
        if (!strategyDetails.config.minimumTradingVolumeLast24h) {
            this.strategyDetails.config.minimumTradingVolumeLast24h = 100;
        }
    }

    public async run(): Promise<TradingState> {
        // 1. Fetch data and select market
        const markets: Array<Market> = await this.fetchMarkets(this.strategyDetails.config.minimumPercentFor24hVariation!)
            .catch(e => Promise.reject(e));
        const market = await this.selectMarketForTrading(markets).catch(e => Promise.reject(e));

        if (!market) {
            log.info("No market was found");
            return Promise.resolve(this.state);
        }

        log.debug(`Using config : ${JSON.stringify(this.strategyDetails)}`);
        this.cryptoExchangePlatform.setMarketMinNotional(market);
        this.cryptoExchangePlatform.printMarketDetails(market);
        this.state.marketSymbol = market.symbol;
        this.state.marketPercentChangeLast24h = market.percentChangeLast24h;
        this.state.candleSticksPercentageVariations = getCandleSticksPercentageVariationsByInterval(market, this.state.selectedCandleStickInterval!);
        log.info("Found market %O", market.symbol);

        // 2. Prepare wallet
        await this.prepareWallet(market, this.strategyDetails.config.authorizedCurrencies!)
            .catch(e => Promise.reject(e));
        const availableOriginAssetAmount = this.refilledWalletBalance?.get(market.originAsset.toString());
        if (availableOriginAssetAmount === undefined) {
            return Promise.reject("No amount of origin asset in the wallet");
        }
        this.emailService.sendEmail(`Trading started on ${market.symbol}`,
            "Current state : \n" + JSON.stringify(this.state, GlobalUtils.replacer, 4) +
            "\n\nMarket details : \n" + JSON.stringify(market, GlobalUtils.replacer, 4)).then().catch(e => log.error(e));

        // 3. Compute the amount of target asset to buy
        const amountToInvest = this.computeAmountToInvest(market, availableOriginAssetAmount);
        const marketUnitPrice = await this.cryptoExchangePlatform.getUnitPrice(market.originAsset, market.targetAsset, true, 10)
            .catch(e => Promise.reject(e));
        const amountOfTargetAssetToBuy = amountToInvest/marketUnitPrice;
        log.debug("Preparing to execute the first order to buy %O %O on %O market. (≈ %O %O). Market unit price is %O",
            amountOfTargetAssetToBuy, market.targetAsset, market.symbol, amountToInvest, market.originAsset, marketUnitPrice);

        // 4. First BUY order to buy market.targetAsset (aka Z)
        const buyOrder = await this.cryptoExchangePlatform.createMarketOrder(market.originAsset, market.targetAsset,
            "buy", amountOfTargetAssetToBuy, true, 5, amountToInvest, market.amountPrecision)
            .catch(e => Promise.reject(e));
        if (this.state.originAssetIsEur) {
            this.state.investedAmountOfEuro = buyOrder.amountOfOriginAsset;
        }
        this.state.amountOfYSpentOnZ = buyOrder.amountOfOriginAsset;

        // 5. First STOP-LIMIT order
        const stopLimitPrice = this.computeFirstStopLimitPrice(market);
        const firstStopLimitOrder = await this.cryptoExchangePlatform.createStopLimitOrder(market.originAsset, market.targetAsset,
            "sell", buyOrder.filled, stopLimitPrice, stopLimitPrice, 3)
            .catch(e => Promise.reject(e));

        // 6. Start trading loop
        const lastStopLimitOrder = await this.runTradingLoop(buyOrder, stopLimitPrice, marketUnitPrice,
            firstStopLimitOrder, market, buyOrder.filled).catch(e => Promise.reject(e));

        // 7. Finishing
        await this.handleTradeEnd(market, lastStopLimitOrder, buyOrder).catch(e => Promise.reject(e));
        return Promise.resolve(this.state);
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, stopLimitPrice: number, marketUnitPrice: number,
        stopLimitOrder: Order, market: Market, targetAssetAmount: number): Promise<Order> {
        let newStopLimitPrice = buyOrder.average;
        const candleStickConfig = this.strategyDetails.config.actifCandleStickIntervals!.get(this.state.selectedCandleStickInterval)!;
        let secondsToSleepInTheTradingLoop = candleStickConfig.initialSecondsToSleepInTheTradingLoop;
        let stopLimitPriceTriggerPercent = candleStickConfig.initialStopLimitPriceTriggerPercent;
        let stopLimitPriceIncreaseInTheTradingLoop = candleStickConfig.initialStopLimitPriceIncreaseInTheTradingLoop;
        let stopTradingTimeoutSeconds = candleStickConfig.stopTradingTimeoutSeconds;
        let lastStopLimitOrder = stopLimitOrder;
        let potentialProfitOnZY;

        while (stopLimitPrice < marketUnitPrice) {
            await GlobalUtils.sleep(secondsToSleepInTheTradingLoop);
            if ((await this.cryptoExchangePlatform.getOrder(lastStopLimitOrder.externalId, lastStopLimitOrder.originAsset, lastStopLimitOrder.targetAsset,
                lastStopLimitOrder.id, lastStopLimitOrder.type!, 300)).status === "closed") {
                break;
            }
            marketUnitPrice = await this.cryptoExchangePlatform.getUnitPrice(market.originAsset, market.targetAsset, false, 10)
                .catch(e => Promise.reject(e));

            if (StrategyUtils.getPercentVariation(newStopLimitPrice, marketUnitPrice) >= stopLimitPriceTriggerPercent) {
                // cancel the previous stop limit order
                await this.cryptoExchangePlatform.cancelOrder(lastStopLimitOrder.externalId, stopLimitOrder.id,
                    market.originAsset, market.targetAsset).catch(e => Promise.reject(e));

                // compute new stop limit price
                newStopLimitPrice = newStopLimitPrice + (newStopLimitPrice * (stopLimitPriceIncreaseInTheTradingLoop/100));
                stopLimitPrice = newStopLimitPrice;

                // create new stop limit order
                lastStopLimitOrder = await this.cryptoExchangePlatform.createStopLimitOrder(market.originAsset, market.targetAsset,
                    "sell", targetAssetAmount, newStopLimitPrice, newStopLimitPrice, 3)
                    .catch(e => Promise.reject(e));

                // after the first stop limit order in the loop is done -> parameters are slightly changed
                secondsToSleepInTheTradingLoop = candleStickConfig.secondsToSleepInTheTradingLoop;
                stopLimitPriceTriggerPercent = candleStickConfig.stopLimitPriceTriggerPercent;
                stopLimitPriceIncreaseInTheTradingLoop = candleStickConfig.stopLimitPriceIncreaseInTheTradingLoop;
            }
            this.state.pricePercentChangeOnZY = Number(StrategyUtils.getPercentVariation(buyOrder.average, marketUnitPrice).toFixed(3));
            potentialProfitOnZY = StrategyUtils.getPercentVariation(buyOrder.average, newStopLimitPrice);
            log.info(`Buy : ${buyOrder.average}, current : ${(marketUnitPrice)
                .toFixed(8)}, change % : ${this.state.pricePercentChangeOnZY}% | Sell price : ${stopLimitPrice
                .toFixed(8)} | Potential profit : ${potentialProfitOnZY.toFixed(3)}%`);

            // cancel trading after x amount of seconds if no profit is made and if the option is enabled
            if (this.state.pricePercentChangeOnZY <= 0 && candleStickConfig.stopTradingTimeoutSeconds !== -1) {
                if (stopTradingTimeoutSeconds > 0) {
                    stopTradingTimeoutSeconds -= secondsToSleepInTheTradingLoop;
                } else {
                    log.info("Aborting trading after %O minutes with loss of %O%",
                        candleStickConfig.stopTradingTimeoutSeconds / 60, this.state.pricePercentChangeOnZY);
                    break;
                }
            }
            if (this.state.pricePercentChangeOnZY <= candleStickConfig.stopTradingMaxPercentLoss) {
                log.info(`Aborting trading as the current trading loss ${this.state.pricePercentChangeOnZY} is >= ${candleStickConfig.stopTradingMaxPercentLoss}%`);
                break;
            }
        }
        return Promise.resolve(lastStopLimitOrder);
    }

    /**
     * If the initial selected market was not accepting EUR (e.g. "CAKE/BNB")
     * then the full amount of origin asset is traded for EUR (e.g. => BNB is sold on "BNB/EUR" market)
     */
    private async handleTradeEnd(market: Market, lastStopLimitOrder: Order, buyOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder = await this.cryptoExchangePlatform.waitForOrderCompletion(lastStopLimitOrder, market.originAsset,
            market.targetAsset, 3).catch(e => Promise.reject(e));
        if (!completedOrder) { // stop limit order took too much => use a MARKET order
            await this.cryptoExchangePlatform.cancelOrder(lastStopLimitOrder.externalId, lastStopLimitOrder.id,
                lastStopLimitOrder.originAsset, lastStopLimitOrder.targetAsset).catch(e => Promise.reject(e));
            completedOrder = await this.cryptoExchangePlatform.createMarketOrder(market.originAsset, market.targetAsset,
                "sell", lastStopLimitOrder.amountOfTargetAsset, true, 5).catch(e => Promise.reject(e));
        }
        this.state.profitOnZY = StrategyUtils.getPercentVariation(buyOrder.filled, completedOrder!.filled);

        if (market.originAsset === Currency.EUR) {
            this.state.retrievedAmountOfEuro = completedOrder!.amountOfOriginAsset!;
        } else {
            const amountOfYToSell = await this.cryptoExchangePlatform.getBalanceForAsset(market.originAsset.toString()).catch(e => Promise.reject(e));
            await this.handleSellOriginAsset(market, amountOfYToSell);
        }

        await this.convertRemainingTargetAssetToBNB(market);
        this.state.profitEuro = this.state.retrievedAmountOfEuro! - this.state.investedAmountOfEuro!;
        this.state.profitPercent = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro!);

        const endWalletBalance = await this.cryptoExchangePlatform.getBalance(this.strategyDetails.config.authorizedCurrencies!)
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
                Array.from(this.strategyDetails.config.actifCandleStickIntervals.keys()))) {
                switch (interval) {
                case CandlestickInterval.THIRTY_MINUTES:
                    this.selectMarketByThirtyMinutesCandleSticks(market, potentialMarkets);
                    break;
                case CandlestickInterval.FOUR_HOURS:
                    this.selectMarketByFourHourCandleSticks(market, potentialMarkets);
                    break;
                case CandlestickInterval.SIX_HOURS:
                    this.selectMarketBySixHoursCandleSticks(market, potentialMarkets);
                    break;
                default:
                    return Promise.reject(`Unable to select a market due to unknown or unhandled candlestick interval : ${interval}`);
                }
            }
        }

        if (potentialMarkets.length === 0) {
            return Promise.resolve(undefined);
        }

        const fourHoursMarket = StrategyUtils.highestBy24hVariation(potentialMarkets.filter(market => market.interval === CandlestickInterval.FOUR_HOURS));
        if (fourHoursMarket) {
            this.state.selectedCandleStickInterval = CandlestickInterval.FOUR_HOURS;
            return Promise.resolve(fourHoursMarket);
        }

        const sixHoursMarket = StrategyUtils.highestBy24hVariation(potentialMarkets.filter(market => market.interval === CandlestickInterval.SIX_HOURS));
        if (sixHoursMarket) {
            this.state.selectedCandleStickInterval = CandlestickInterval.SIX_HOURS;
            return Promise.resolve(sixHoursMarket);
        }

        // by default, take the first market
        this.state.selectedCandleStickInterval = potentialMarkets[0].interval;
        return Promise.resolve(potentialMarkets[0].market);
    }

    private selectMarketByFourHourCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>) {
        const candleStickVariations = getCandleSticksPercentageVariationsByInterval(market, CandlestickInterval.FOUR_HOURS);
        const currentVariation = getCurrentCandleStickPercentageVariation(candleStickVariations);

        // to avoid strange markets such as PHB/BTC, QKC/BTC or DF/ETH in Binance
        if (StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations.slice(candleStickVariations.length - 30))) {
            return;
        }

        // if second candle has a variation < x%
        if (candleStickVariations[candleStickVariations.length - 2] < 9) {
            return;
        }
        log.debug(`Potential market (4h candlesticks): ${JSON.stringify(market)}`);

        // if second candle has a variation > x%
        if (candleStickVariations[candleStickVariations.length - 2] > 25) {
            return;
        }

        // if price is decreasing
        if (currentVariation <= 0) {
            return;
        }

        // if price increased by x% (considered as too late to start trading)
        if (currentVariation > 4) {
            return;
        }

        // if the previous candlesticks had a relatively big percent change
        if (candleStickVariations.slice(candleStickVariations.length - 22, candleStickVariations.length - 2)
            .some(variation => Math.abs(variation) > 6.5)) {
            return;
        }

        // if the price variation between the open price of one candlestick and the
        // close price of the 3rd candlestick is bigger that x%
        const startPrice = market.candleSticks.get(CandlestickInterval.FOUR_HOURS)![candleStickVariations.length - 15][1];
        const endPrice = market.candleSticks.get(CandlestickInterval.FOUR_HOURS)![candleStickVariations.length - 3][4];
        if (Math.abs(StrategyUtils.getPercentVariation(startPrice, endPrice)) > 5) {
            return;
        }

        log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.FOUR_HOURS);
        potentialMarkets.push({ market, interval: CandlestickInterval.FOUR_HOURS });
    }

    private selectMarketBySixHoursCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>) {
        const candleStickVariations = getCandleSticksPercentageVariationsByInterval(market, CandlestickInterval.SIX_HOURS);
        const currentVariation = getCurrentCandleStickPercentageVariation(candleStickVariations);

        // to avoid strange markets such as PHB/BTC, QKC/BTC or DF/ETH in Binance
        if (StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations.slice(candleStickVariations.length - 30))) {
            return;
        }

        // if second candle has a variation < x%
        if (candleStickVariations[candleStickVariations.length - 2] < 9) {
            return;
        }
        log.debug(`Potential market (6h candlesticks): ${JSON.stringify(market)}`);

        // if second candle has a variation > x%
        if (candleStickVariations[candleStickVariations.length - 2] > 25) {
            return;
        }

        // if price is decreasing
        if (currentVariation <= 0) {
            return;
        }

        // if price increased by x% (considered as too late to start trading)
        if (currentVariation > 4) {
            return;
        }

        // if the previous candlesticks had a relatively big percent change
        if (candleStickVariations.slice(candleStickVariations.length - 18, candleStickVariations.length - 2)
            .some(variation => Math.abs(variation) > 7)) {
            return;
        }

        // if the price variation between the open price of one of previous candlesticks and the
        // close price of the 3rd candlestick is bigger that x%
        const startPrice = market.candleSticks.get(CandlestickInterval.SIX_HOURS)![candleStickVariations.length - 10][1];
        const endPrice = market.candleSticks.get(CandlestickInterval.SIX_HOURS)![candleStickVariations.length - 3][4];
        if (Math.abs(StrategyUtils.getPercentVariation(startPrice, endPrice)) > 5) {
            return;
        }

        log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.SIX_HOURS);
        potentialMarkets.push({ market, interval: CandlestickInterval.SIX_HOURS });
    }

    private selectMarketByThirtyMinutesCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>) {
        const candleStickVariations = getCandleSticksPercentageVariationsByInterval(market, CandlestickInterval.THIRTY_MINUTES);
        const currentVariation = getCurrentCandleStickPercentageVariation(candleStickVariations);

        // to avoid strange markets such as PHB/BTC, QKC/BTC or DF/ETH in Binance
        if (StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations.slice(candleStickVariations.length - 50))) {
            return;
        }

        // if second candle has a variation < x%
        if (candleStickVariations[candleStickVariations.length - 2] < 7) {
            return;
        }
        log.debug(`Potential market (30m candlesticks): ${JSON.stringify(market)}`);

        // if price is decreasing
        if (currentVariation <= 0) {
            return;
        }

        // if price increased by x% (considered as too late to start trading)
        if (currentVariation > 4) {
            return;
        }

        // if the previous candlesticks had a relatively big percent change
        if (candleStickVariations.slice(candleStickVariations.length - 32,
            candleStickVariations.length - 2).some(variation => Math.abs(variation) > 2)) {
            return;
        }

        // if the price variation between the open price of one candlestick and the
        // close price of the 3rd candlestick is bigger that x%
        const openPrice = market.candleSticks.get(CandlestickInterval.THIRTY_MINUTES)![candleStickVariations.length - 17][1];
        const closePrice = market.candleSticks.get(CandlestickInterval.THIRTY_MINUTES)![candleStickVariations.length - 3][4];
        if (Math.abs(StrategyUtils.getPercentVariation(openPrice, closePrice)) > 5) {
            return;
        }

        log.debug("Added potential market %O with interval %O", market.symbol, CandlestickInterval.THIRTY_MINUTES);
        potentialMarkets.push({ market, interval: CandlestickInterval.THIRTY_MINUTES });
    }

    /**
     * @return All potentially interesting markets after filtering based on various criteria
     */
    private async fetchMarkets(minimumPercentVariation: number): Promise<Array<Market>> {
        let markets: Array<Market> = await this.cryptoExchangePlatform.getMarketsBy24hrVariation(minimumPercentVariation)
            .catch(e => Promise.reject(e));
        this.cryptoExchangePlatform.setMarketAmountPrecision(markets);
        markets = StrategyUtils.filterByAuthorizedCurrencies(markets, this.strategyDetails.config.authorizedCurrencies);
        markets = StrategyUtils.filterByMinimumTradingVolume(markets, this.strategyDetails.config.minimumTradingVolumeLast24h);
        markets = StrategyUtils.filterByIgnoredMarkets(markets, this.strategyDetails.config.ignoredMarkets);
        markets = StrategyUtils.filterByAuthorizedMarkets(markets, this.strategyDetails.config.authorizedMarkets);
        markets = StrategyUtils.filterByAmountPrecision(markets, 1); // when trading with big price amounts, this can maybe be removed

        await this.cryptoExchangePlatform.fetchCandlesticks(markets, this.defaultCandleStickInterval, this.defaultNumberOfCandlesticks)
            .catch(e => Promise.reject(e));
        markets = StrategyUtils.filterByMinimumAmountOfCandleSticks(markets, this.defaultNumberOfCandlesticks, CandlestickInterval.THIRTY_MINUTES);
        await this.setCandlesticksAndTheirVariations(markets).catch(e => Promise.reject(e));
        return Promise.resolve(markets);
    }

    private async setCandlesticksAndTheirVariations(markets: Array<Market>): Promise<void> {
        StrategyUtils.setCandlestickPercentVariations(markets, this.defaultCandleStickInterval);

        // 30 min candlesticks are added by default

        StrategyUtils.addCandleSticksWithInterval(markets, CandlestickInterval.FOUR_HOURS);
        StrategyUtils.setCandlestickPercentVariations(markets, CandlestickInterval.FOUR_HOURS);

        StrategyUtils.addCandleSticksWithInterval(markets, CandlestickInterval.SIX_HOURS);
        StrategyUtils.setCandlestickPercentVariations(markets, CandlestickInterval.SIX_HOURS);
    }

    /**
     * Fetches wallet information and refills it if needed
     */
    private async prepareWallet(market: Market, authorizedCurrencies: Array<Currency>): Promise<void> {
        this.initialWalletBalance = await this.cryptoExchangePlatform.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        this.state.initialWalletBalance = JSON.stringify(Array.from(this.initialWalletBalance!.entries()));
        log.info("Initial wallet balance : %O", this.initialWalletBalance);
        await this.refillOriginAsset(market, this.initialWalletBalance!)
            .catch(e => Promise.reject(e));
        this.refilledWalletBalance = await this.cryptoExchangePlatform.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        this.state.refilledWalletBalance = JSON.stringify(Array.from(this.refilledWalletBalance!.entries()));
        log.info("Updated wallet balance after refill : %O", this.refilledWalletBalance);
        return Promise.resolve();
    }

    /**
     * Buys an x amount of origin asset.
     * Example : to trade 10€ on the market with symbol BNB/BTC one has to buy 10€ worth of BTC before continuing.
     */
    private async refillOriginAsset(market: Market, walletBalance: Map<string, number>): Promise<void> {
        const availableAmountOfOriginAsset = this.initialWalletBalance?.get(market.originAsset.toString());
        if (availableAmountOfOriginAsset === undefined) {
            return Promise.reject(`The available amount of ${market.originAsset} could not be determined`);
        }
        if (availableAmountOfOriginAsset === 0 && market.originAsset === Currency.EUR) {
            return Promise.reject(`You have 0 EUR :(`);
        }

        // We suppose that before starting the trading, we only have EUR in the wallet
        // and when we finish the trading, we convert everything back to EUR.
        // Below we are going to convert the needed amount of EUR into `originAsset`.
        if (market.originAsset !== Currency.EUR) {
            const unitPriceInEur = await this.cryptoExchangePlatform.getUnitPrice(Currency.EUR, market.originAsset, true, 10)
                .catch(e => Promise.reject(e));
            let amountToBuy;
            if (walletBalance.get(Currency.EUR)! >= this.strategyDetails.config.maxMoneyToTrade) {
                amountToBuy = this.strategyDetails.config.maxMoneyToTrade/unitPriceInEur;
            } else {
                // if we don't have enough EUR then we buy the minimal possible amount
                amountToBuy = market.minNotional!;
            }

            const order = await this.cryptoExchangePlatform.createMarketOrder(Currency.EUR,
                market.originAsset, "buy", amountToBuy, true)
                .catch(e => Promise.reject(e));
            this.marketUnitPriceOfOriginAssetInEur = order.average;
            this.state.initialUnitPriceOnYXMarket = order.average;
            this.state.investedAmountOfEuro = order.amountOfOriginAsset;
            this.state.amountOfYBought = order.filled;
        }
        return Promise.resolve();
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
     * If the market is 'WIN/BNB' then it sells 'BNB'
     */
    private async handleSellOriginAsset(market: Market, amountToSell: number) {
        const order = await this.cryptoExchangePlatform.createMarketOrder(Currency.EUR, market.originAsset,
            "sell", amountToSell, true).catch(e => Promise.reject(e));
        this.state.retrievedAmountOfEuro = order.amountOfOriginAsset;
        this.state.endUnitPriceOnYXMarket = order.average;
        this.state.pricePercentChangeOnYX = StrategyUtils.getPercentVariation(this.state.initialUnitPriceOnYXMarket!,
            this.state.endUnitPriceOnYXMarket);
    }

    /**
     * @return The amount of ${@link Market.originAsset} that will be invested
     */
    private computeAmountToInvest(market: Market, availableOriginAssetAmount: number): number {
        if (market.originAsset === Currency.EUR) {
            this.state.originAssetIsEur = true;
            return Math.min(availableOriginAssetAmount, this.strategyDetails.config.maxMoneyToTrade);
        } else {
            this.state.originAssetIsEur = false;
            return this.state.amountOfYBought!;
        }
    }

    private computeFirstStopLimitPrice(market: Market): number {
        let candleSticks;
        if (this.state.selectedCandleStickInterval! === CandlestickInterval.FOUR_HOURS) {
            candleSticks = getCandleSticksByInterval(market, CandlestickInterval.FOUR_HOURS);
        } else if (this.state.selectedCandleStickInterval! === CandlestickInterval.THIRTY_MINUTES) {
            candleSticks = getCandleSticksByInterval(market, CandlestickInterval.THIRTY_MINUTES);
        } else if (this.state.selectedCandleStickInterval! === CandlestickInterval.SIX_HOURS) {
            candleSticks = getCandleSticksByInterval(market, CandlestickInterval.SIX_HOURS);
        }
        if (!candleSticks) {
            throw new Error(`Unknown candlestick interval ${this.state.selectedCandleStickInterval!}`);
        }
        return getCandleStick(candleSticks, candleSticks.length - 3)[3];
    }
}

export type MountainSeekerConfig = BaseStrategyConfig & {
    /** The maximum amount of money (in EUR) that a strategy is allowed to use for trading. */
    maxMoneyToTrade: number;

    /** Markets that will be filtered out and never be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    ignoredMarkets?: Array<string>;

    /** Markets that can be selected.
     * It is an array of market symbols, for example : ["BNB/EUR", ...] */
    authorizedMarkets?: Array<string>;

    /** The currencies that the strategy is allowed to use for trading.
     * Example: we want to buy on GAS/BTC market but we only have EUR in the wallet.
     * Therefore, the strategy will convert EUR to BTC */
    authorizedCurrencies?: Array<Currency>;

    /** Used to keep only those markets that have at least this number of percentage variation
     * in last 24 hours. Can be negative */
    minimumPercentFor24hVariation?: number;

    /** Intervals (e.g. '1m', '15m', '1h' ...) that will be used for selecting a market and their config */
    actifCandleStickIntervals?: Map<string, TradingLoopConfig>;

    /** Minimum trading volume of origin asset last 24h*/
    minimumTradingVolumeLast24h?: number;
}

type TradingLoopConfig = {
    /** Seconds to sleep during trading loop while monitoring the price.
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialSecondsToSleepInTheTradingLoop: number;

    /** Number in percent by which the stop limit price increases.
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialStopLimitPriceIncreaseInTheTradingLoop: number;

    /** For triggering a new stop limit order if the difference between current
     * unit price and current stop limit price becomes greater than this number (in %).
     * FOR FIRST STOP LIMIT ORDER IN THE LOOP ONLY (to limit the risk of loss) */
    initialStopLimitPriceTriggerPercent: number;

    /** Seconds to sleep during trading loop while monitoring the price */
    secondsToSleepInTheTradingLoop: number;

    /** Number in percent by which the stop limit price increases (e.g. 1 for 1%) */
    stopLimitPriceIncreaseInTheTradingLoop: number;

    /** For triggering a new stop limit order if the difference between current
     * unit price and current stop limit price becomes greater than this number (in %) */
    stopLimitPriceTriggerPercent: number;

    /** Amount of seconds after which the trading is aborted if no profit is made
     * when the trading loop has started. -1 for infinity */
    stopTradingTimeoutSeconds: number;

    /** Loss in percentage after which the trading will stop.
     * Example: -10 stands for a loss of -10% */
    stopTradingMaxPercentLoss: number;
}