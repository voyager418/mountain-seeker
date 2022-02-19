import { BaseStrategy } from "./base-strategy.interface";
import { Account } from "../models/account";
import log from '../logging/log.instance';
import { Strategy } from "../models/strategy";
import { BinanceConnector } from "../api-connectors/binance-connector";
import { getCandleSticksByInterval, getCandleSticksPercentageVariationsByInterval, Market } from "../models/market";
import { Currency } from "../enums/trading-currencies.enum";
import { StrategyUtils } from "../utils/strategy-utils";
import { GlobalUtils } from "../utils/global-utils";
import { Order } from "../models/order";
import { EmailService } from "../services/email-service";
import { ConfigService } from "../services/config-service";
import { injectable } from "tsyringe";
import { BinanceDataService } from "../services/observer/binance-data-service";
import { MountainSeekerV2Config, TradingLoopConfig } from "./config/mountain-seeker-v2-config";
import { MountainSeekerV2State } from "./state/mountain-seeker-v2-state";
import { NumberUtils } from "../utils/number-utils";
import { MarketSelector } from "./marketselector/msv2/market-selector";
import { SelectorResult } from "./marketselector/selector.interface";
import { DynamodbRepository } from "../repository/dynamodb-repository";

/**
 * Mountain Seeker V2.
 * The general idea is to enter a trade when previous candle increased by a big amount.
 */
@injectable()
export class MountainSeekerV2 implements BaseStrategy {
    /** If a loss of -7% or less is reached it means that something went wrong, and we abort everything */
    private static MAX_LOSS_TO_ABORT_EXECUTION = -7;

    private account: Account = { email: '', maxMoneyAmount: 0, mailPreferences: {}, activeStrategies: [] };
    private state: MountainSeekerV2State = { id: "", accountEmail: "" };
    private strategy: Strategy<MountainSeekerV2Config> | undefined;
    private markets: Array<Market> = [];
    private market?: Market;
    private initialWalletBalance?: Map<string, number>;
    private amountOfTargetAssetThatWasBought?: number;

    constructor(private configService: ConfigService,
        private binanceConnector: BinanceConnector,
        private emailService: EmailService,
        private binanceDataService: BinanceDataService,
        private marketSelector: MarketSelector,
        private dynamoDbRepository: DynamodbRepository) {
        if (!this.configService.isSimulation() && process.env.NODE_ENV !== "prod") {
            log.warn("WARNING : this is not a simulation");
        }
    }

    getState(): MountainSeekerV2State {
        return this.state;
    }

    public setup(account: Account): MountainSeekerV2 {
        this.account = account;
        this.binanceConnector.setup(account);
        this.state.accountEmail = this.account.email;
        this.state.marketLastTradeDate = new Map<string, Date>();
        this.state.profitOfPreviousTrade = 0;
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
                log.error(`Trading was aborted due to an error: ${e}. Stacktrace: ${JSON.stringify((e as any).stack)}`);
                await this.emailService.sendEmail(this.account.email === "simulation" ? process.env.ADMIN_EMAIL! : this.account.email,
                    "Trading stopped...", JSON.stringify({
                        error: error.message,
                        account: this.account.email,
                        strategyDetails: this.state.strategyDetails,
                        uniqueID: this.state.id
                    }, GlobalUtils.replacer, 4));
            }
        }
    }

    private prepareForNextTrade(): void {
        if (this.state.marketSymbol) {
            this.account.runningState = undefined;
            this.dynamoDbRepository.updateAccount(this.account);
            this.dynamoDbRepository.addState(this.state);

            const profit = this.state.profitPercent;
            if (!this.strategy!.config.simulation! && profit && profit <= MountainSeekerV2.MAX_LOSS_TO_ABORT_EXECUTION) {
                throw new Error(`Aborting due to a big loss: ${this.state.profitPercent}%`);
            }
            if (!this.strategy!.config.simulation! &&
                profit! + this.state.profitOfPreviousTrade! <= MountainSeekerV2.MAX_LOSS_TO_ABORT_EXECUTION) {
                throw new Error(`Aborting due to a big loss during last two trades. Previous: ${this.state.profitOfPreviousTrade}%, current: ${profit}%`);
            }
            if (!this.strategy!.config.autoRestart) {
                this.binanceDataService.removeObserver(this);
                return;
            }
            this.state.marketLastTradeDate!.set(this.state.marketSymbol, new Date());
            this.state = { id: "", accountEmail: this.account.email, profitOfPreviousTrade: profit, marketLastTradeDate: this.state.marketLastTradeDate }; // resetting the state after a trade
            this.amountOfTargetAssetThatWasBought = undefined;
            this.market = undefined;
        }
    }

    public async run(): Promise<void> {
        // 1. Filter and select market
        this.markets = this.getFilteredMarkets();
        this.market = await this.selectMarketForTrading().catch(e => Promise.reject(e));

        if (!this.market) {
            if (this.configService.isSimulation()) {
                log.debug("No market was found");
            }
            return Promise.resolve();
        }

        log.debug(`Using config : ${JSON.stringify(this.strategy, GlobalUtils.replacer)}`);
        this.state.marketSymbol = this.market.symbol;
        this.printMarketDetails(this.market);
        this.state.marketPercentChangeLast24h = this.market.percentChangeLast24h;
        log.info("Selected market %O", this.market.symbol);

        // 2. Fetch wallet balance and compute amount of BUSD to invest
        await this.getInitialBalance([Currency.BUSD.toString(), this.market.targetAsset]);
        const availableBusdAmount = this.initialWalletBalance?.get(Currency.BUSD.toString());
        const busdAmountToInvest = this.computeAmountToInvest(availableBusdAmount!);

        // 3. First BUY MARKET order to buy market.targetAsset
        const buyOrder = await this.createFirstMarketBuyOrder(busdAmountToInvest).catch(e => Promise.reject(e));
        this.amountOfTargetAssetThatWasBought = buyOrder.filled;
        const tradingLoopConfig = this.strategy!.config.tradingLoopConfig;
        this.emailService.sendInitialEmail(this.account, this.strategy!, this.state, this.market, buyOrder.amountOfOriginAsset!, buyOrder.average,
            this.initialWalletBalance!).then().catch(e => log.error(e));
        this.account.runningState =  {
            strategy: this.strategy!,
            amountOfTargetAssetThatWasBought: buyOrder.filled,
            marketOriginAsset: this.market.originAsset,
            marketTargetAsset: this.market.targetAsset
        };
        this.dynamoDbRepository.updateAccount(this.account);

        // 4. Trading loop
        await this.runTradingLoop(buyOrder, tradingLoopConfig);

        // 5. Finishing
        return this.handleTradeEnd(buyOrder).catch(e => Promise.reject(e));
    }

    /**
     * Monitors the current market price and creates new stop limit orders if price increases.
     */
    private async runTradingLoop(buyOrder: Order, tradingLoopConfig: TradingLoopConfig): Promise<void> {
        let marketUnitPrice = Infinity;
        this.state.runUp = -Infinity;
        this.state.drawDown = Infinity;
        let priceChange;
        const endTradingDate = GlobalUtils.getCurrentBelgianDate();
        const stopLossPrice = NumberUtils.decreaseNumberByPercent(buyOrder.average, tradingLoopConfig.stopTradingMaxPercentLoss);
        endTradingDate.setSeconds(endTradingDate.getSeconds() + tradingLoopConfig.secondsToSleepAfterTheBuy);

        while (GlobalUtils.getCurrentBelgianDate() < endTradingDate) {
            await GlobalUtils.sleep(tradingLoopConfig.priceWatchInterval);

            marketUnitPrice = await this.binanceConnector.getUnitPrice(this.market!.originAsset, this.market!.targetAsset, this.configService.isSimulation(), 10)
                .catch(e => Promise.reject(e));

            priceChange = Number(NumberUtils.getPercentVariation(buyOrder.average, marketUnitPrice).toFixed(3));
            this.state.runUp = Math.max(this.state.runUp, priceChange);
            this.state.drawDown = Math.min(this.state.drawDown, priceChange);

            if (marketUnitPrice <= stopLossPrice) {
                // if price dropped below stop loss order price and the stop loss order is still open
                log.debug(`Price change is too low ${priceChange}% ! Stop price is ${stopLossPrice} while the current is ${marketUnitPrice}`);
                break;
            }
        }
        return Promise.resolve();
    }

    private async handleTradeEnd(firstBuyOrder: Order): Promise<void> {
        log.debug("Finishing trading...");
        const sellOrder = await this.binanceConnector.createMarketSellOrder(this.market!.originAsset,
            this.market!.targetAsset, firstBuyOrder.filled, true, 5,
            undefined, this.strategy!.config.simulation).catch(e => Promise.reject(e));

        this.state.retrievedAmountOfBusd = sellOrder!.amountOfOriginAsset!;
        this.state.profitMoney = Number((this.state.retrievedAmountOfBusd! - this.state.investedAmountOfBusd!).toFixed(2));
        this.state.profitPercent = Number(NumberUtils.getPercentVariation(this.state.investedAmountOfBusd!, this.state.retrievedAmountOfBusd!).toFixed(2));
        this.state.endDate = sellOrder.datetime;

        const endWalletBalance = await this.binanceConnector.getBalance([Currency.BUSD.toString(), this.market!.targetAsset], 3, true)
            .catch(e => Promise.reject(e));
        this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
        await this.emailService.sendFinalMail(this.account, this.strategy!, this.state, this.market!,
            firstBuyOrder.amountOfOriginAsset!, sellOrder, this.initialWalletBalance!, endWalletBalance).catch(e => log.error(e));
        const finalLog = `Final percent change : ${this.state.profitPercent}
            | State : ${JSON.stringify(this.state)}
            | Account : ${JSON.stringify(this.account.email)} 
            | Strategy : ${JSON.stringify(this.strategy)}
            | Market : ${JSON.stringify(this.market)}
            | maxVariation : ${this.strategy!.metadata?.maxVariation?.toFixed(2)}
            | edgeVariation : ${this.strategy!.metadata?.edgeVariation?.toFixed(2)} 
            | volumeRatio : ${this.strategy!.metadata?.volumeRatio?.toFixed(2)}
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
            moneyAmountToInvest, true, 5, this.strategy!.config.simulation).catch(e => Promise.reject(e));
        this.state.investedAmountOfBusd = buyOrder.amountOfOriginAsset;
        return buyOrder;
    }

    /**
     * @return A market which will be used for trading. Or `undefined` if not found
     */
    private async selectMarketForTrading(): Promise<Market | undefined> {
        if (this.configService.isSimulation()) {
            this.strategy = this.account.activeStrategies[0];
            return this.markets[0];
        }
        const potentialMarkets: Array<SelectorResult> = [];
        for (const market of this.markets) {
            for (const activeStrategy of this.account.activeStrategies) {
                const selectorResult: SelectorResult | undefined = this.marketSelector.isMarketEligible(this.state, market, activeStrategy);
                if (selectorResult) {
                    log.debug("Added potential market %O with interval %O for strategy %O", market.symbol,
                        selectorResult.interval, selectorResult.strategyCustomName);
                    potentialMarkets.push(selectorResult);
                }
            }
        }

        if (potentialMarkets.length === 0) {
            return undefined;
        }

        // TODO select the best among the found ones
        const selectionResult = potentialMarkets.reduce((prev, current) =>
            (prev.maxVariation! < current.maxVariation! ? prev : current));

        this.strategy = this.account.activeStrategies.find(s => selectionResult.strategyCustomName === s.customName)!;
        this.strategy.customName = selectionResult.strategyCustomName;
        this.strategy.metadata = {};
        this.strategy.metadata.maxVariation = selectionResult.maxVariation;
        this.strategy.metadata.edgeVariation = selectionResult.edgeVariation;
        this.strategy.metadata.volumeRatio = selectionResult.volumeRatio;
        this.state.last5CandleSticksPercentageVariations = getCandleSticksPercentageVariationsByInterval(selectionResult.market,
            selectionResult.interval).slice(-5);
        this.state.last5CandleSticks = getCandleSticksByInterval(selectionResult.market, selectionResult.interval).slice(-5);
        this.state.strategyDetails = this.strategy;

        if (selectionResult.earlyStart) {
            this.state.last5CandleSticksPercentageVariations.shift();
            this.state.last5CandleSticksPercentageVariations?.push(0);
            this.state.last5CandleSticks.shift();
            this.state.last5CandleSticks?.push([0, 0, 0, 0, 0, 0]);
        }
        return selectionResult.market;
    }

    /**
     * @return All potentially interesting markets after filtering based on various criteria
     */
    private getFilteredMarkets(): Array<Market> {
        this.markets = StrategyUtils.filterByAuthorizedCurrencies(this.markets, [Currency.BUSD]);
        // this.markets = StrategyUtils.filterByIgnoredMarkets(this.markets, this.strategy!.config.ignoredMarkets);
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
        return Math.min(availableAmountOfBusd, this.strategy!.config.maxMoneyToTrade, this.account.maxMoneyAmount);
    }

    /**
     * First tries to cancel the stop limit order and then tries to sell {@link Market.targetAsset}
     */
    private async abort(): Promise<void> {
        if (this.amountOfTargetAssetThatWasBought !== undefined && this.amountOfTargetAssetThatWasBought !== 0) {
            log.debug(`Aborting - selling ${this.amountOfTargetAssetThatWasBought} ${this.market?.targetAsset}`);
            let sellMarketOrder;
            try {
                sellMarketOrder = await this.binanceConnector.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
                    this.amountOfTargetAssetThatWasBought, true, 3,
                    undefined, this.strategy!.config.simulation);
            } catch (e) {
                log.error(`Error while creating market sell order : ${JSON.stringify(e)}`);
            }

            if (!sellMarketOrder) {
                for (const percent of [0.05, 0.5, 1, 2]) {
                    const decreasedAmount = NumberUtils.decreaseNumberByPercent(
                        this.amountOfTargetAssetThatWasBought, percent);
                    try {
                        sellMarketOrder = await this.binanceConnector.createMarketOrder(this.market!.originAsset!,
                            this.market!.targetAsset, "sell", decreasedAmount,
                            true, 3, undefined, undefined, this.strategy!.config.simulation);
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