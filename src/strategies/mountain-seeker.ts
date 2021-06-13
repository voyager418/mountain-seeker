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
import { singleton } from "tsyringe";
import { CandlestickInterval } from "../enums/candlestick-interval.enum";


/**
 * The general goal of this strategy is to select and buy an action
 * that is, and recently was, harshly rising in price.
 * Then sell it when the price starts to decrease.
 */
@singleton()
export class MountainSeeker implements BaseStrategy {
    private strategyDetails: any
    private account: Account | undefined;
    private marketUnitPriceOfOriginAssetInEur = -1;
    private initialWalletBalance?: Map<string, number>;
    private refilledWalletBalance?: Map<string, number>;
    private readonly defaultCandleStickInterval = CandlestickInterval.THIRTY_MINUTES;

    private state: TradingState = {
        id: uuidv4()
    };

    constructor(private configService: ConfigService,
        private apiConnector: BinanceConnector,
        private emailService: EmailService) {
        if (!this.configService.isSimulation() && process.env.NODE_ENV !== "prod") {
            log.warn("WARNING : this is not a simulation");
        }
    }

    public setup(account: Account, strategyDetails: StrategyDetails<MountainSeekerConfig>) {
        this.account = account;
        this.strategyDetails = strategyDetails;
        this.state.config = strategyDetails;
        this.initDefaultConfig(strategyDetails);
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
        if (!strategyDetails.config.candleStickInterval) {
            const configFor1m: TradingLoopConfig = {
                initialSecondsToSleepInTheTradingLoop: 3,
                secondsToSleepInTheTradingLoop: 60,
                initialStopLimitPriceIncreaseInTheTradingLoop: 0.1,
                stopLimitPriceIncreaseInTheTradingLoop: 0.5,
                initialStopLimitPriceTriggerPercent: 1.0,
                stopLimitPriceTriggerPercent: 2.5,
                stopTradingTimeoutSeconds: -1
            };
            const configFor4h: TradingLoopConfig = {
                initialSecondsToSleepInTheTradingLoop: 60,
                secondsToSleepInTheTradingLoop: 600,
                initialStopLimitPriceIncreaseInTheTradingLoop: 0.1,
                stopLimitPriceIncreaseInTheTradingLoop: 1.0,
                initialStopLimitPriceTriggerPercent: 1.5,
                stopLimitPriceTriggerPercent: 3,
                stopTradingTimeoutSeconds: -1
            };
            this.strategyDetails.config.candleStickInterval = new Map([["1m", configFor1m], ["4h", configFor4h]]);
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
        this.apiConnector.setMarketMinNotional(market);
        this.apiConnector.printMarketDetails(market);
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
            "Current state : \n" + JSON.stringify(this.state, null, 4) +
            "\n\nMarket details : \n" + JSON.stringify(market, null, 4)).then().catch(e => log.error(e));

        // 3. Compute the amount of target asset to buy
        const amountToInvest = this.computeAmountToInvest(market, availableOriginAssetAmount);
        const marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset, true)
            .catch(e => Promise.reject(e));
        const amountOfTargetAssetToBuy = amountToInvest/marketUnitPrice;
        log.debug("Preparing to execute the first order to buy %O %O on %O market. (≈ %O %O). Market unit price is %O",
            amountOfTargetAssetToBuy, market.targetAsset, market.symbol, amountToInvest, market.originAsset, marketUnitPrice);

        // Before buying, one last check that the price still rises
        const selectedCandleSticks = getCandleSticksByInterval(market, this.state.selectedCandleStickInterval!);
        if (marketUnitPrice < selectedCandleSticks[selectedCandleSticks.length - 2][4]) { // if current price dropped below the 2nd candlestick's close price
            log.info(`Cancelling trading for market ${JSON.stringify(market)}`);
            if (market.originAsset === Currency.EUR) {
                this.state.profitEuro = 0;
                this.state.percentChange = 0;
                this.state.endedWithoutErrors = true;
                await this.emailService.sendEmail(`Trading canceled for ${market.symbol} (${this.state.percentChange > 0
                    ? '+' : ''}${this.state.percentChange.toFixed(3)}%, ${this.state.profitEuro.toFixed(2)}€)`, "Final state is : \n" +
                    JSON.stringify(this.state, null, 4)).catch(e => log.error(e));
                log.info(`Trading cancelled ${JSON.stringify(this.state)}`);
                return Promise.resolve(this.state);
            } else {
                await this.handleSellOriginAsset(market, availableOriginAssetAmount);
                this.state.profitEuro = this.state.retrievedAmountOfEuro! - this.state.investedAmountOfEuro!;
                this.state.percentChange = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro!);
                log.info(`Final percent change : ${this.state.percentChange}`);
                await this.emailService.sendEmail(`Trading canceled for ${market.symbol} (${this.state.percentChange > 0
                    ? '+' : ''}${this.state.percentChange.toFixed(3)}%, ${this.state.profitEuro.toFixed(2)}€)`, "Final state is : \n" +
                    JSON.stringify(this.state, null, 4)).catch(e => log.error(e));
                log.info(`Trading cancelled ${JSON.stringify(this.state)}`);
                this.state.endedWithoutErrors = true;
                return Promise.resolve(this.state);
            }
        }

        // 4. First BUY order on target market
        const buyOrder = await this.apiConnector.createMarketOrder(market.originAsset, market.targetAsset,
            "buy", amountOfTargetAssetToBuy, true, 3, amountToInvest).catch(e => Promise.reject(e));
        if (this.state.originAssetIsEur) {
            this.state.investedAmountOfEuro = buyOrder.amountOfOriginAsset;
        }
        this.state.amountOfYSpentOnZ = buyOrder.amountOfOriginAsset;

        // 5. First STOP-LIMIT order
        const targetAssetAmount = buyOrder.filled;
        const stopLimitPrice = this.computeFirstStopLimitPrice(market);
        const firstStopLimitOrder = await this.apiConnector.createStopLimitOrder(market.originAsset, market.targetAsset,
            "sell", targetAssetAmount, stopLimitPrice, stopLimitPrice, 3)
            .catch(e => Promise.reject(e));

        // 6. Start trading loop
        const lastStopLimitOrder = await this.runTradingLoop(buyOrder, stopLimitPrice, marketUnitPrice,
            firstStopLimitOrder, market, targetAssetAmount).catch(e => Promise.reject(e));

        // 7. Finishing
        await this.handleTradeEnd(market, lastStopLimitOrder).catch(e => Promise.reject(e));
        return Promise.resolve(this.state);
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, stopLimitPrice: number, marketUnitPrice: number,
        stopLimitOrder: Order, market: Market, targetAssetAmount: number): Promise<Order> {
        let newStopLimitPrice = buyOrder.average!;
        const candleStickConfig = this.strategyDetails.config.candleStickInterval!.get(this.state.selectedCandleStickInterval)!;
        let secondsToSleepInTheTradingLoop = candleStickConfig.initialSecondsToSleepInTheTradingLoop;
        let stopLimitPriceTriggerPercent = candleStickConfig.initialStopLimitPriceTriggerPercent;
        let stopLimitPriceIncreaseInTheTradingLoop = candleStickConfig.initialStopLimitPriceIncreaseInTheTradingLoop;
        let stopTradingTimeoutSeconds = candleStickConfig.stopTradingTimeoutSeconds;
        let lastStopLimitOrder = stopLimitOrder;

        while (stopLimitPrice < marketUnitPrice) {
            await GlobalUtils.sleep(secondsToSleepInTheTradingLoop);
            if ((await this.apiConnector.getOrder(lastStopLimitOrder.externalId, lastStopLimitOrder.originAsset, lastStopLimitOrder.targetAsset,
                lastStopLimitOrder.id, lastStopLimitOrder.type!, 300)).status === "closed") {
                break;
            }
            marketUnitPrice = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset)
                .catch(e => log.error(e));

            if (StrategyUtils.getPercentVariation(newStopLimitPrice, marketUnitPrice) >= stopLimitPriceTriggerPercent) {
                // cancel the previous stop limit order
                await this.apiConnector.cancelOrder(lastStopLimitOrder.externalId, stopLimitOrder.id,
                    market.originAsset, market.targetAsset).catch(e => Promise.reject(e));

                // compute new stop limit price
                newStopLimitPrice = newStopLimitPrice + (newStopLimitPrice * (stopLimitPriceIncreaseInTheTradingLoop/100));
                stopLimitPrice = newStopLimitPrice;

                // create new stop limit order
                lastStopLimitOrder = await this.apiConnector.createStopLimitOrder(market.originAsset, market.targetAsset,
                    "sell", targetAssetAmount, newStopLimitPrice, newStopLimitPrice, 3)
                    .catch(e => Promise.reject(e));

                // after the first stop limit order in the loop is done -> parameters are slightly changed
                secondsToSleepInTheTradingLoop = candleStickConfig.secondsToSleepInTheTradingLoop;
                stopLimitPriceTriggerPercent = candleStickConfig.stopLimitPriceTriggerPercent;
                stopLimitPriceIncreaseInTheTradingLoop = candleStickConfig.stopLimitPriceIncreaseInTheTradingLoop;
            }
            this.state.pricePercentChangeOnZY = StrategyUtils.getPercentVariation(buyOrder.average!, stopLimitPrice);
            log.info(`Buy : ${buyOrder.average}, current : ${(marketUnitPrice)
                .toFixed(8)}, change % : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                marketUnitPrice)).toFixed(3)}% | Sell price : ${stopLimitPrice
                .toFixed(8)} | Profit : ${(StrategyUtils.getPercentVariation(buyOrder.average!,
                newStopLimitPrice)).toFixed(3)}%`);

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
        }
        return Promise.resolve(lastStopLimitOrder);
    }

    /**
     * If the initial selected market was not accepting EUR (e.g. "CAKE/BNB")
     * then the full amount of origin asset is traded for EUR (e.g. => BNB is sold on "BNB/EUR" market)
     */
    private async handleTradeEnd(market: Market, lastStopLimitOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        let completedOrder = await this.apiConnector.waitForOrderCompletion(lastStopLimitOrder, market.originAsset,
            market.targetAsset, 3).catch(e => Promise.reject(e));
        if (!completedOrder) { // stop limit order took too much => use a MARKET order
            await this.apiConnector.cancelOrder(lastStopLimitOrder.externalId, lastStopLimitOrder.id,
                lastStopLimitOrder.originAsset, lastStopLimitOrder.targetAsset).catch(e => Promise.reject(e));
            completedOrder = await this.apiConnector.createMarketOrder(Currency.EUR, market.originAsset,
                "sell", lastStopLimitOrder.amountOfTargetAsset, true).catch(e => Promise.reject(e));
        }
        if (market.originAsset === Currency.EUR) {
            this.state.retrievedAmountOfEuro = completedOrder!.amountOfOriginAsset!;
        } else {
            log.debug("amountOfYBought = %O / amountOfYSpentOnZ = %O / amountOfOriginAsset = %O",
                this.state.amountOfYBought!, this.state.amountOfYSpentOnZ!, completedOrder!.amountOfOriginAsset!);
            const amountOfYToSell = (this.state.amountOfYBought! - this.state.amountOfYSpentOnZ!) + completedOrder!.amountOfOriginAsset!
            await this.handleSellOriginAsset(market, amountOfYToSell);
        }

        await this.convertRemainingTargetAssetToBNB(market);
        this.state.profitEuro = this.state.retrievedAmountOfEuro! - this.state.investedAmountOfEuro!;
        this.state.percentChange = StrategyUtils.getPercentVariation(this.state.investedAmountOfEuro!, this.state.retrievedAmountOfEuro!);
        log.info(`Final percent change : ${this.state.percentChange}`);

        const endWalletBalance = await this.apiConnector.getBalance(this.strategyDetails.config.authorizedCurrencies!)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendEmail(`Trading finished on ${market.symbol} (${this.state.percentChange > 0
            ? '+' : ''}${this.state.percentChange.toFixed(3)}%, ${this.state.profitEuro.toFixed(2)}€)`, "Final state is : \n" +
            JSON.stringify(this.state, null, 4)).catch(e => log.error(e));
        this.state.endedWithoutErrors = true;
        log.info(`Trading finished ${JSON.stringify(this.state)}`);
        return Promise.resolve();
    }

    /**
     * Searches the best market based on some criteria.
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private async selectMarketForTrading(markets: Array<Market>): Promise<Market | undefined> {
        const potentialMarkets: Array<{market: Market, interval: CandlestickInterval}> = [];
        for (const market of markets) {
            for (const interval of market.candleStickIntervals) {
                switch (interval){
                case CandlestickInterval.ONE_MINUTE:
                    this.selectMarketByOneMinuteCandlesticks(market, potentialMarkets);
                    break;
                case CandlestickInterval.THIRTY_MINUTES:
                    this.selectMarketByThirtyMinutesCandleSticks(market, potentialMarkets);
                    break;
                case CandlestickInterval.FOUR_HOURS:
                    this.selectMarketByFourHourCandleSticks(market, potentialMarkets);
                    break;
                default:
                    return Promise.reject(`Unable to select a market due to unknown or unhandled candlestick interval : ${interval}`);
                }
            }
        }

        if (potentialMarkets.length > 0) {
            // TODO : define a better logic instead of picking the first
            this.state.selectedCandleStickInterval = potentialMarkets[0].interval;
            return Promise.resolve(potentialMarkets[0].market);
        }
        // if (potentialMarkets.length > 0) {
        //     // return the market with the highest previous candlestick % variation
        //     return Promise.resolve(potentialMarkets.reduce((prev, current) =>
        //         ((getCandleStickPercentageVariation(prev.candleSticksPercentageVariations,
        //             prev.candleSticksPercentageVariations.length - 2) >
        //             getCandleStickPercentageVariation(current.candleSticksPercentageVariations,
        //                 current.candleSticksPercentageVariations.length - 2)) ? prev : current)));
        // }
        return Promise.resolve(undefined);
    }

    private selectMarketByFourHourCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>) {
        const candleStickVariations = getCandleSticksPercentageVariationsByInterval(market, CandlestickInterval.FOUR_HOURS);
        const currentVariation = getCurrentCandleStickPercentageVariation(candleStickVariations);

        if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as
            !candleStickVariations.some(variation => variation === 0)) {      // PHB/BTC, QKC/BTC or DF/ETH in Binance
            // if second candle has a variation > x%
            if (candleStickVariations[candleStickVariations.length - 2] >= 10) {
                log.debug(`Potential market (4h candlesticks): ${JSON.stringify(market)}`);
                // if current price is increasing
                // and if the first x candles don't have a variation > y%
                if (currentVariation > 0 && currentVariation <= 4 &&
                    !candleStickVariations.slice(0, candleStickVariations.length - 2)
                        .some(variation => Math.abs(variation) > 6.5)) {
                    potentialMarkets.push({ market, interval: CandlestickInterval.FOUR_HOURS });
                }
            }
        }
    }

    private selectMarketByThirtyMinutesCandleSticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>) {
        const candleStickVariations = getCandleSticksPercentageVariationsByInterval(market, CandlestickInterval.THIRTY_MINUTES);
        const currentVariation = getCurrentCandleStickPercentageVariation(candleStickVariations);

        if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as
            !candleStickVariations.some(variation => variation === 0)) {      // PHB/BTC, QKC/BTC or DF/ETH in Binance
            // if second candle has a variation > x%
            if (candleStickVariations[candleStickVariations.length - 2] >= 10) {
                log.debug(`Potential market (30m candlesticks): ${JSON.stringify(market)}`);
                // if current price is increasing
                // and if the first x candles don't have a variation > y%
                if (currentVariation > 0 && currentVariation <= 4 &&
                    !candleStickVariations.slice(0, candleStickVariations.length - 2)
                        .some(variation => Math.abs(variation) > 6.5)) {
                    potentialMarkets.push({ market, interval: CandlestickInterval.THIRTY_MINUTES });
                }
            }
        }
    }

    private selectMarketByOneMinuteCandlesticks(market: Market, potentialMarkets: Array<{ market: Market; interval: CandlestickInterval }>): void {
        const candleStickVariations = getCandleSticksPercentageVariationsByInterval(market, CandlestickInterval.ONE_MINUTE);
        const currentVariation = getCurrentCandleStickPercentageVariation(candleStickVariations);
        const candleSticks = getCandleSticksByInterval(market, CandlestickInterval.ONE_MINUTE);

        if (!StrategyUtils.arrayHasDuplicatedNumber(candleStickVariations) && // to avoid strange markets such as
            !candleStickVariations.some(variation => variation === 0)) {      // PHB/BTC, QKC/BTC or DF/ETH in Binance
            if (currentVariation >= 0.1) { // if current price is increasing
                // if the variation between open price of 4th candle and close price of 2nd candle >= x%
                // OR if the variation between open price of 16th candle and close price of 2nd candle >= x%
                if (StrategyUtils.getPercentVariation(candleSticks[candleSticks.length - 4][1],
                    candleSticks[candleSticks.length - 2][4]) >= 9 ||
                    StrategyUtils.getPercentVariation(candleSticks[candleSticks.length - 16][1],
                        candleSticks[candleSticks.length - 2][4]) >= 9) {
                    log.debug(`Potential market (1m candlesticks): ${JSON.stringify(market)}`);
                    // if 44 variations except the first x, do not exceed x%
                    // and there is no candle in the first 16 candles that has a close price > than the open price of first candle
                    if (!candleStickVariations.slice(candleStickVariations.length - 60, candleStickVariations.length - 16)
                        .some(variation => Math.abs(variation) > 3) &&
                        !candleSticks.slice(candleSticks.length - 16, candleSticks.length - 1)
                            .some(candle => candle[4] > candleSticks[candleSticks.length - 1][1])
                    ) {
                        potentialMarkets.push({ market, interval: CandlestickInterval.ONE_MINUTE });
                    }
                }
            }
        }
    }

    /**
     * @return All potentially interesting markets
     */
    private async fetchMarkets(minimumPercentVariation: number): Promise<Array<Market>> {
        let markets: Array<Market> = await this.apiConnector.getMarketsBy24hrVariation(minimumPercentVariation)
            .catch(e => Promise.reject(e));
        this.apiConnector.setMarketAmountPrecision(markets);
        markets = StrategyUtils.filterByAuthorizedCurrencies(markets, this.strategyDetails.config.authorizedCurrencies);
        markets = StrategyUtils.filterByMinimumTradingVolume(markets, this.strategyDetails.config.minimumTradingVolumeLast24h);
        markets = StrategyUtils.filterByIgnoredMarkets(markets, this.strategyDetails.config.ignoredMarkets);
        markets = StrategyUtils.filterByAuthorizedMarkets(markets, this.strategyDetails.config.authorizedMarkets);
        markets = StrategyUtils.filterByAmountPrecision(markets, 1); // when trading with big price amounts, this can maybe be removed
        // TODO : filter by minimum amount of candlesticks

        await this.fetchAndSetCandlesticks(markets).catch(e => Promise.reject(e));
        return Promise.resolve(markets);
    }

    private async fetchAndSetCandlesticks(markets: Array<Market>): Promise<void> {
        await this.apiConnector.fetchCandlesticks(markets, this.defaultCandleStickInterval, 500)
            .catch(e => Promise.reject(e));
        StrategyUtils.setCandlestickPercentVariations(markets, this.defaultCandleStickInterval);

        StrategyUtils.addCandleSticksWithInterval(markets, CandlestickInterval.FOUR_HOURS);
        StrategyUtils.setCandlestickPercentVariations(markets, CandlestickInterval.FOUR_HOURS);

    }

    /**
     * Fetches wallet information and refills it if needed
     */
    private async prepareWallet(market: Market, authorizedCurrencies: Array<Currency>): Promise<void> {
        this.initialWalletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        this.state.initialWalletBalance = JSON.stringify(Array.from(this.initialWalletBalance!.entries()));
        log.info("Initial wallet balance : %O", this.initialWalletBalance);
        await this.refillOriginAsset(market, this.initialWalletBalance!)
            .catch(e => Promise.reject(e));
        this.refilledWalletBalance = await this.apiConnector.getBalance(authorizedCurrencies)
            .catch(e => Promise.reject(e));
        this.state.refilledWalletBalance = JSON.stringify(Array.from(this.refilledWalletBalance!.entries()));
        log.info("Updated wallet balance after refill : %O", this.refilledWalletBalance);
        return Promise.resolve();
    }

    /**
     * Buys an x amount of origin asset.
     * Example : to trade 10€ on the market with symbol BNB/BTC without having
     * 10€ worth of BTC, one has to buy the needed amount of BTC before continuing.
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
            const unitPriceInEur = await this.apiConnector.getUnitPrice(Currency.EUR, market.originAsset, true)
                .catch(e => Promise.reject(e));
            let amountToBuy;
            if (walletBalance.get(Currency.EUR)! >= this.strategyDetails.config.maxMoneyToTrade) {
                amountToBuy = this.strategyDetails.config.maxMoneyToTrade/unitPriceInEur;
            } else {
                // if we don't have enough EUR then we buy the minimal possible amount
                amountToBuy = market.minNotional!;
            }

            const order = await this.apiConnector.createMarketOrder(Currency.EUR,
                market.originAsset, "buy", amountToBuy, true)
                .catch(e => Promise.reject(e));
            this.marketUnitPriceOfOriginAssetInEur = order.average!;
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
        const walletBalance = await this.apiConnector.getBalance([Currency.BNB, market.targetAsset])
            .catch(e => Promise.reject(e));
        const initialBNBAmount = walletBalance.get(Currency.BNB)!;
        if (walletBalance.get(market.targetAsset)! > 0) {
            await this.apiConnector.convertSmallAmountsToBNB([market.targetAsset]);
            const finalBNBAmount = await this.apiConnector.getBalanceForAsset(Currency.BNB).catch(e => Promise.reject(e));

            if (!this.state.retrievedAmountOfEuro) {
                this.state.retrievedAmountOfEuro = 0;
            }

            if (initialBNBAmount === finalBNBAmount) {
                log.warn(`Was unable to convert ${walletBalance.get(market.targetAsset)}${market.targetAsset} to ${Currency.BNB}`);
                const priceOfTargetAssetInOriginAsset = await this.apiConnector.getUnitPrice(market.originAsset, market.targetAsset, true)
                    .catch(e => Promise.reject(e));
                const priceOfOriginAssetInEUR = await this.apiConnector.getUnitPrice(Currency.EUR, market.originAsset, true)
                    .catch(e => Promise.reject(e));
                const equivalentInEUR = walletBalance.get(market.targetAsset)! * priceOfTargetAssetInOriginAsset * priceOfOriginAssetInEUR;
                log.debug(`Remaining ${walletBalance.get(market.targetAsset)!}${market.targetAsset} equals to ${equivalentInEUR}€`);
                this.state.retrievedAmountOfEuro += equivalentInEUR;
            } else {
                const priceOfBNBInEUR = await this.apiConnector.getUnitPrice(Currency.EUR, Currency.BNB, true)
                    .catch(e => Promise.reject(e));
                const equivalentInEUR = priceOfBNBInEUR * (finalBNBAmount - initialBNBAmount);
                log.debug(`Converted ${finalBNBAmount - initialBNBAmount}${Currency.BNB} equals to ${equivalentInEUR}€`);
                this.state.retrievedAmountOfEuro += equivalentInEUR;
            }
        }
    }

    /**
     * If the market is 'WIN/BNB' then it sells 'BNB'
     */
    private async handleSellOriginAsset(market: Market, amountToSell: number) {
        const order = await this.apiConnector.createMarketOrder(Currency.EUR, market.originAsset,
            "sell", amountToSell, true).catch(e => Promise.reject(e));
        this.state.retrievedAmountOfEuro = order.amountOfOriginAsset;
        this.state.endUnitPriceOnYXMarket = order.average;
        this.state.pricePercentChangeOnYX = StrategyUtils.getPercentVariation(this.state.initialUnitPriceOnYXMarket!,
            this.state.endUnitPriceOnYXMarket!);
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
        const candleSticks = getCandleSticksByInterval(market, CandlestickInterval.ONE_MINUTE);
        if (this.state.selectedCandleStickInterval! === CandlestickInterval.ONE_MINUTE) {
            return Math.min(
                getCandleStick(candleSticks, candleSticks.length - 20)[3],
                getCandleStick(candleSticks, candleSticks.length - 19)[3],
                getCandleStick(candleSticks, candleSticks.length - 18)[3],
                getCandleStick(candleSticks, candleSticks.length - 17)[3],
                getCandleStick(candleSticks, candleSticks.length - 16)[3],
                getCandleStick(candleSticks, candleSticks.length - 15)[3],
                getCandleStick(candleSticks, candleSticks.length - 14)[3],
                getCandleStick(candleSticks, candleSticks.length - 13)[3]);
        } else if (this.state.selectedCandleStickInterval! === CandlestickInterval.FOUR_HOURS) {
            return getCandleStick(candleSticks, candleSticks.length - 3)[3];
        } else if (this.state.selectedCandleStickInterval! === CandlestickInterval.THIRTY_MINUTES) {
            return getCandleStick(candleSticks, candleSticks.length - 3)[3];
        }

        throw new Error(`Unknown candlestick interval ${this.state.selectedCandleStickInterval!}`);
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

    /** Intervals (e.g. '1m', '15m', '1h' ...) and their config */
    candleStickInterval?: Map<string, TradingLoopConfig>;

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
}