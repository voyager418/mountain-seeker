import { singleton } from "tsyringe";
import { DynamodbRepository } from "../repository/dynamodb-repository";
import { BinanceConnector } from "../api-connectors/binance-connector";
import log from "../logging/log.instance";
import { Account } from "../models/account";
import { Email } from "../enums/email.enum";

/**
 * If server restarts and there are incomplete trades, this class
 * is used to try to sell everything for each user
 */
@singleton()
export class SellService {

    constructor(private dynamodbRepository: DynamodbRepository,
        private binanceConnector: BinanceConnector) {
    }

    public async sellUnfinishedTrades(): Promise<Array<Account>> {
        const accounts = await this.dynamodbRepository.getAllAccounts();
        let error = false;
        for (const account of accounts) {
            if (account.isActive && account.runningState && account.email !== Email.SIMULATION) {
                log.info(`Account ${account.email} has unfinished trade: ${JSON.stringify(account.runningState)}`);
                this.binanceConnector.setup(account);
                try {
                    const order = await this.binanceConnector.createMarketSellOrder(account.runningState.marketOriginAsset,
                        account.runningState.marketTargetAsset, account.runningState.amountOfTargetAssetThatWasBought, true, 3);
                    log.info(`Successfully created sell order ${JSON.stringify(order)}`);
                    account.runningState = undefined;
                    await this.dynamodbRepository.updateAccount(account);
                } catch (e) {
                    log.error(`Failed to finish trade for account ${account.email}: ${e}. Stacktrace: ${JSON.stringify((e as any).stack)}`);
                    error = true;
                }
            }
        }
        if (error) {
            // if at least 1 error then the program will not start
            return Promise.reject("There was a problem to sell an unfinished trade");
        }
        return accounts;
    }

}