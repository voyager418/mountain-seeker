// import { BaseStrategy } from "./base-strategy.interface";
// import { Account } from "../models/account";
// import log from '../logging/log.instance';
// import { BaseStrategyConfig, StrategyDetails } from "../models/strategy-details";
// import { v4 as uuidv4 } from 'uuid';
// import { BinanceConnector } from "../api-connectors/binance-connector";
// import { Market, TOHLCV } from "../models/market";
// import { Currency } from "../enums/trading-currencies.enum";
// import { GlobalUtils } from "../utils/global-utils";
// import { Order } from "../models/order";
// import { EmailService } from "../services/email-service";
// import { ConfigService } from "../services/config-service";
// import { injectable } from "tsyringe";
// import { MountainSeekerV2Config } from "./config/mountain-seeker-v2-config";
// import { MountainSeekerV2State } from "./state/mountain-seeker-v2-state";
// import { TwitterDataService } from "../services/observer/twitter-data-service";
// import { CandlestickInterval } from "../enums/candlestick-interval.enum";
// import { NumberUtils } from "../utils/number-utils";
//
// const axios = require('axios').default;
//
// /**
//  * Mountain Seeker V3.
//  * Buys few seconds later when a new market is added on Binance
//  */
// @injectable()
// export class MountainSeekerV3 implements BaseStrategy {
//     /** If a loss of -7% or less is reached it means that something went wrong and we abort everything */
//     private static MAX_LOSS_TO_ABORT_EXECUTION = -7;
//
//     /* eslint-disable  @typescript-eslint/no-explicit-any */
//     private strategyDetails: any;
//     private account: any;
//     private initialWalletBalance?: Map<string, number>;
//     private state: MountainSeekerV2State;
//     private config: MountainSeekerV2Config & BaseStrategyConfig = { maxMoneyToTrade: -1 };
//     private market?: Market;
//     private amountOfTargetAssetThatWasBought?: number;
//     private latestTweet = "";
//
//     constructor(private configService: ConfigService,
//         private cryptoExchangePlatform: BinanceConnector,
//         private emailService: EmailService,
//         private twitterDataService: TwitterDataService) {
//         this.state = { id: uuidv4() };
//         if (!this.configService.isSimulation() && process.env.NODE_ENV !== "prod") {
//             log.warn("WARNING : this is not a simulation");
//         }
//     }
//
//     getState(): MountainSeekerV2State {
//         return this.state;
//     }
//
//     public setup(account: Account, strategyDetails: StrategyDetails<MountainSeekerV2Config>): MountainSeekerV3 {
//         log.debug(`Adding new strategy ${JSON.stringify(strategyDetails)}`);
//         this.account = account;
//         this.strategyDetails = strategyDetails;
//         this.config = strategyDetails.config;
//         this.initDefaultConfig(strategyDetails);
//         this.twitterDataService.registerObserver(this);
//         return this;
//     }
//
//     async update(latestTweet: string): Promise<void> {
//         if (!this.state.marketSymbol && MountainSeekerV3.tweetAboutNewToken(latestTweet)) { // if there is no active trading
//             log.info(`Tweet about new token : ${latestTweet}`);
//             this.latestTweet = latestTweet;
//             try {
//                 await this.run();
//                 this.prepareForNextTrade();
//             } catch (e) {
//                 await this.abort();
//                 this.twitterDataService.removeObserver(this);
//                 const error = new Error(e);
//                 log.error("Trading was aborted due to an error : ", error);
//                 await this.emailService.sendEmail("Trading stopped...", error.message);
//             }
//         }
//     }
//
//     private prepareForNextTrade(): void {
//         if (this.state.marketSymbol) {
//             if (this.state.profitPercent && this.state.profitPercent <= MountainSeekerV3.MAX_LOSS_TO_ABORT_EXECUTION) {
//                 throw new Error(`Aborting due to a big loss : ${this.state.profitPercent}%`);
//             }
//             if (!this.config.autoRestartOnProfit) {
//                 this.twitterDataService.removeObserver(this);
//                 return;
//             }
//             this.config.marketLastTradeDate!.set(this.state.marketSymbol, new Date());
//             this.state = { id: uuidv4() }; // resetting the state after a trade
//             this.amountOfTargetAssetThatWasBought = undefined;
//             this.market = undefined;
//         }
//     }
//
//     /**
//      * Set default config values
//      */
//     private initDefaultConfig(strategyDetails: StrategyDetails<MountainSeekerV2Config>) {
//         this.config.marketLastTradeDate = new Map<string, Date>();
//         if (!strategyDetails.config.authorizedCurrencies) {
//             this.config.authorizedCurrencies = [Currency.BUSD];
//         }
//     }
//
//     public async run(): Promise<void> {
//         const infoAboutTokenFromBinanceHTMLPage = await this.getNewTokenInfo().catch(e => Promise.reject(e));
//         await this.selectMarketForTrading(infoAboutTokenFromBinanceHTMLPage).catch(e => Promise.reject(e));
//
//         if (!this.market) {
//             if (this.configService.isSimulation()) {
//                 log.debug("No market was found");
//             }
//             return Promise.resolve();
//         }
//
//         this.state.marketSymbol = this.market.symbol;
//         await this.waitForTokenToGoLive(infoAboutTokenFromBinanceHTMLPage).catch(e => Promise.reject(e));
//
//         log.debug(`Using config : ${JSON.stringify(this.strategyDetails)}`);
//         this.cryptoExchangePlatform.printMarketDetails(this.market);
//
//         // 2. Fetch wallet balance and compute amount of BUSD to invest
//         await this.getInitialBalance([Currency.BUSD.toString(), this.market.targetAsset]); // TODO add reject
//         const availableBusdAmount = this.initialWalletBalance?.get(Currency.BUSD.toString());
//         // const currentMarketPrice = await this.cryptoExchangePlatform.getUnitPrice(Currency.BUSD, this.market.targetAsset, false, 5)
//         //     .catch(e => Promise.reject(e));
//         const usdtAmountToInvest = Math.min(availableBusdAmount!, this.config.maxMoneyToTrade);
//
//         // 3. First BUY MARKET order to buy market.targetAsset
//         const buyOrder = await this.createFirstMarketBuyOrder(usdtAmountToInvest).catch(e => Promise.reject(e));
//         this.amountOfTargetAssetThatWasBought = buyOrder.filled;
//         await GlobalUtils.sleep(50);
//
//         // 6. Finishing
//         return await this.handleTradeEnd(buyOrder).catch(e => Promise.reject(e));
//     }
//
//
//     private async handleTradeEnd(buyOrder: Order): Promise<void> {
//         log.debug("Finishing trading...");
//         const completedOrder = await this.cryptoExchangePlatform.createMarketSellOrder(this.market!.originAsset, this.market!.targetAsset,
//             buyOrder.filled, true, 5).catch(e => Promise.reject(e));
//
//         this.state.retrievedAmountOfBusd = completedOrder!.amountOfOriginAsset!;
//         await this.handleRedeem();
//
//         this.state.profitMoney = this.state.retrievedAmountOfBusd! - this.state.investedAmountOfBusd!;
//         this.state.profitPercent = NumberUtils.getPercentVariation(this.state.investedAmountOfBusd!, this.state.retrievedAmountOfBusd!);
//
//         const endWalletBalance = await this.cryptoExchangePlatform.getBalance([Currency.BUSD.toString(), this.market!.targetAsset], 3, true)
//             .catch(e => Promise.reject(e));
//         this.state.endWalletBalance = JSON.stringify(Array.from(endWalletBalance.entries()));
//         await this.emailService.sendFinalMail(this.strategyDetails, this.market!, buyOrder.amountOfOriginAsset!, this.state.retrievedAmountOfBusd!,
//             this.state.profitMoney, this.state.profitPercent, this.initialWalletBalance!, endWalletBalance,
//             this.state.runUp!, this.state.drawDown!, this.strategyDetails.type, completedOrder).catch(e => log.error(e));
//         this.state.endedWithoutErrors = true;
//         // TODO print full account object when api key/secret are moved to DB
//         log.info(`Final percent change : ${this.state.profitPercent.toFixed(2)} | State : ${JSON
//             .stringify(this.state)} | Account : ${JSON.stringify(this.account.email)} | Strategy : ${JSON.stringify(this.strategyDetails)}`);
//         return Promise.resolve();
//     }
//
//     /**
//      * Sometimes Binance is not able to sell everything so in this method, if the market is BLVT,
//      * we will try to sell the remaining amount. In order to add it to the profit
//      */
//     private async handleRedeem(): Promise<void> {
//         if (!this.market?.quoteOrderQtyMarketAllowed) {
//             try {
//                 const amountNotSold = await this.cryptoExchangePlatform.getBalanceForAsset(this.market!.targetAsset, 3);
//                 if (amountNotSold && amountNotSold > 0) {
//                     const redeemOrder = await this.cryptoExchangePlatform.redeemBlvt(this.market!.targetAsset!, amountNotSold, 5);
//                     log.debug(`Local redeem order object : ${redeemOrder} , retrievedAmountOfBusd : ${this.state.retrievedAmountOfBusd}`);
//                     if (this.state.retrievedAmountOfBusd !== undefined && this.state.retrievedAmountOfBusd !== 0) {
//                         this.state.retrievedAmountOfBusd += redeemOrder.amount;
//                     } else {
//                         this.state.retrievedAmountOfBusd = redeemOrder.amount;
//                     }
//                 }
//             } catch (e) {
//                 log.error(`Failed to redeem BLVT : ${JSON.stringify(e)}`)
//             }
//         }
//     }
//
//     /**
//      * If the market accepts quote price then it will create a BUY MARKET order by specifying how much we want to spend.
//      * Otherwise it will compute the equivalent amount of target asset and make a different buy order.
//      */
//     private async createFirstMarketBuyOrder(usdtAmountToInvest: number, currentMarketPrice?: number): Promise<Order> {
//         const retries = 5;
//         // if (this.market!.quoteOrderQtyMarketAllowed) {
//         const buyOrder = await this.cryptoExchangePlatform.createMarketBuyOrder(this.market!.originAsset, this.market!.targetAsset,
//             usdtAmountToInvest, true, retries).catch(e => Promise.reject(e));
//         // } else {
//         //     buyOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset, this.market!.targetAsset,
//         //         "buy", usdtAmountToInvest / currentMarketPrice, true, retries, usdtAmountToInvest, this.market!.amountPrecision)
//         //         .catch(e => Promise.reject(e));
//         // }
//         this.state.investedAmountOfBusd = buyOrder.amountOfOriginAsset;
//         return buyOrder;
//     }
//
//     /**
//      * @return A market which will be used for trading. Or `undefined` if not found
//      */
//     private async selectMarketForTrading(tokenText: string): Promise<void> {
//         const market: Market = {
//             candleStickIntervals: [CandlestickInterval.ONE_MINUTE],
//             candleSticks: new Map<CandlestickInterval, Array<TOHLCV>>(),
//             candleSticksPercentageVariations: new Map<CandlestickInterval, Array<number>>(),
//             originAsset: Currency.BUSD,
//             symbol: "",
//             targetAsset: "",
//             targetAssetPrice: 0
//         };
//         for (const word of tokenText.split(" ")) {
//             if (word.endsWith("/" + Currency.BUSD) && !word.substr(0, market.symbol.indexOf("/")).endsWith("UP") &&
//                 !word.substr(0, market.symbol.indexOf("/")).endsWith("DOWN")) {
//                 market.symbol = word;
//                 break;
//             }
//         }
//
//         let candlesticks = [];
//         try {
//             candlesticks = await this.cryptoExchangePlatform.getCandlesticks(market.symbol, CandlestickInterval.ONE_MINUTE, 10, 3);
//         } catch (e) {
//             log.warn(e);
//         }
//         if (candlesticks.length > 0) {
//             log.warn(`Market ${market.symbol} already exists`);
//             return Promise.resolve(undefined);
//         }
//         market.targetAsset = market.symbol.substr(0, market.symbol.indexOf("/"));
//         this.market = market;
//         this.state.marketSymbol = market.symbol;
//         log.info(`Selected market ${JSON.stringify(market)}`);
//         return Promise.resolve();
//     }
//
//
//     /**
//      * Fetches wallet information
//      */
//     private async getInitialBalance(assets: Array<string>): Promise<void> {
//         this.initialWalletBalance = await this.cryptoExchangePlatform.getBalance(assets, 3)
//             .catch(e => Promise.reject(e));
//         this.state.initialWalletBalance = JSON.stringify(Array.from(this.initialWalletBalance!.entries()));
//         log.info("Initial wallet balance : %O", this.initialWalletBalance);
//         return Promise.resolve();
//     }
//
//     /**
//      * @return The amount of {@link Currency.BUSD} that will be invested (the minimum between the available
//      * and the max money to trade)
//      */
//     private computeAmountToInvest(availableAmountOfBusd: number, maxAmountToBuy: number): number {
//         return Math.min(availableAmountOfBusd, this.config.maxMoneyToTrade, maxAmountToBuy);
//     }
//
//     /**
//      * First tries to cancel the stop limit order and then tries to sell {@link Market.targetAsset}
//      */
//     private async abort(): Promise<void> {
//         if (this.amountOfTargetAssetThatWasBought) {
//             log.debug(`Aborting - selling ${this.amountOfTargetAssetThatWasBought} ${this.market?.targetAsset}`);
//             let sellMarketOrder;
//             try {
//                 sellMarketOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset!,
//                 this.market!.targetAsset!, "sell", this.amountOfTargetAssetThatWasBought, true, 3);
//             } catch (e) {
//                 log.error(`Error while creating market sell order : ${JSON.stringify(e)}`);
//             }
//
//             if (!sellMarketOrder) {
//                 for (const percent of [0.05, 0.5, 1, 2]) {
//                     this.amountOfTargetAssetThatWasBought = NumberUtils.decreaseNumberByPercent(
//                         this.amountOfTargetAssetThatWasBought, percent);
//                     try {
//                         sellMarketOrder = await this.cryptoExchangePlatform.createMarketOrder(this.market!.originAsset!,
//                             this.market!.targetAsset!, "sell", this.amountOfTargetAssetThatWasBought,
//                             true, 3);
//                         if (sellMarketOrder) {
//                             break;
//                         }
//                     } catch (e) {
//                         log.error(`Exception occurred while creating market sell order : ${JSON.stringify(e)}`);
//                     }
//                 }
//             }
//         }
//     }
//
//     /**
//      * Example of such tweet : "#Binance will list @MeritCircle_IO $MC\n\nhttps://t.co/c557IbhlQ2"
//      * @return `true` if the tweet is about addition of a new token
//      */
//     private static tweetAboutNewToken(latestTweet: string): boolean {
//         return latestTweet.indexOf("https://t.co") > -1 && latestTweet.startsWith("#Binance") &&
//             (latestTweet.indexOf(" will list ") > -1 && latestTweet.indexOf(" $") > -1);
//     }
//
//     private async getNewTokenInfo(): Promise<string> {
//         const urlToTokenHTMLPage = this.latestTweet.substr(this.latestTweet.indexOf("https://t.co"), 23);
//         log.info(`Token page URL : ${urlToTokenHTMLPage}`);
//         try {
//             const htmlPage: string = (await axios.get(urlToTokenHTMLPage)).data;
//             // log.debug(`Received HTML token page : ${htmlPage}`);
//             const startTextIndex = htmlPage.indexOf("Binance will list ") > -1 ?
//                 htmlPage.lastIndexOf("Binance will list ") : htmlPage.lastIndexOf("Binance will open trading for ");
//             if (startTextIndex === -1) {
//                 return Promise.reject(`Text about token not found`);
//             }
//             return Promise.resolve(htmlPage.substr(startTextIndex, 1000));
//         } catch (e) {
//             log.warn(`Error after HTTP call while getting new binance token info: ${e}`);
//             return Promise.reject(e);
//         }
//     }
//
//     private async waitForTokenToGoLive(infoAboutTokenFromBinanceHTMLPage: string): Promise<void> {
//         const keyWords = "trading pairs at ";
//         const startDateIndex = infoAboutTokenFromBinanceHTMLPage.indexOf(keyWords) + keyWords.length;
//         const dateString = infoAboutTokenFromBinanceHTMLPage.substr(startDateIndex, 16);
//         // const dateString = "2021-12-05 06:00";
//         const tokenLaunchDate = new Date(dateString);
//         tokenLaunchDate.setHours(tokenLaunchDate.getHours() + 1);
//
//         const currentDate = GlobalUtils.getCurrentBelgianDate();
//         const secondsDifference = (tokenLaunchDate.getTime() - currentDate.getTime()) / 1000;
//         if (secondsDifference <= 0) {
//             return Promise.reject(`Something went wrong with dates. Current date : ${currentDate} , token launch date : ${tokenLaunchDate}`);
//         }
//         log.info(`Sleeping until ${tokenLaunchDate} (for ${secondsDifference} seconds) `);
//         await GlobalUtils.sleep(secondsDifference);
//         return Promise.resolve();
//     }
// }