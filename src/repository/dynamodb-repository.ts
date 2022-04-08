import log from "../logging/log.instance";
import { ConfigService } from "../services/config-service";
import { singleton } from "tsyringe";
import { AWSError, DynamoDB } from "aws-sdk";
const AWS = require("aws-sdk");
import { Account } from "../models/account";
import { MountainSeekerV2State } from "../strategies/state/mountain-seeker-v2-state";
import { DocumentClient } from "aws-sdk/lib/dynamodb/document_client";
import { TradingState } from "../strategies/state/trading-state";

/**
 * Repository responsible to write data to and read data from the DynamoDB database
 */
@singleton()
export class DynamodbRepository {
    private readonly db;
    private readonly documentClient: DocumentClient;

    constructor(private configService: ConfigService) {
        AWS.config.update({
            region: configService.getConfig().aws.region,
            endpoint: configService.getConfig().database.url
        });
        this.documentClient = new AWS.DynamoDB.DocumentClient();
        this.db = new AWS.DynamoDB();
        if (configService.isSimulation()) {
            this.createLocalAccountTable();
        }
    }

    public async updateAccount(account: Account): Promise<Account> {
        const params = {
            TableName: "Accounts",
            Item: {
                email: account.email,
                account
            }
        };
        await this.documentClient.put(params).promise();
        log.debug("Updated account %O", account.email);
        return Promise.resolve(account); // TODO return database response instead
    }

    public async getAllAccounts(): Promise<Array<Account>> {
        const accounts: Array<Account> = [];
        const params = {
            TableName: "Accounts"
        };
        const data = await this.documentClient.scan(params).promise();
        if (data && data.Items) {
            data.Items.forEach(item => accounts.push(<Account> item.account));
        }
        return accounts;
    }

    public async getAccount(email: string): Promise<Promise<Account> | undefined> {
        const params = {
            TableName: "Accounts",
            Key: {
                email
            }
        };
        const data = await this.documentClient.get(params).promise();
        if (data.Item) {
            log.debug(`Fetched account ${data.Item.account.email}`);
            return data.Item.account;
        }
        return undefined;
    }

    public addState(state: MountainSeekerV2State): void {
        if (this.configService.isSimulation()) {
            return;
        }
        const params = {
            TableName: "TradingStates",
            Item: {
                id: state.id,
                state
            }
        };
        this.documentClient.put(params, (err: AWSError) => {
            if (err) {
                log.error(`Unable to add item: ${JSON.stringify(err)}`);
            } else {
                log.debug("Updated state %O for account %O", state.id, state.accountEmail);
            }
        });
    }

    public async getUserStats(email: string): Promise<Array<any> | undefined> {
        let params: DynamoDB.DocumentClient.ScanInput = {
            ExpressionAttributeValues: {
                ':accountEmail' : email
            },
            ExpressionAttributeNames: {
                "#trading_state": "state"
            },
            FilterExpression: '#trading_state.accountEmail = :accountEmail',
            ProjectionExpression: '#trading_state.profitPercent, #trading_state.profitMoney, #trading_state.strategyDetails.customName',
            TableName: 'TradingStates'
        };
        const resultArray: MountainSeekerV2State[] = [];
        const res = [];
        let notFinished = true;
        while (notFinished) {
            const data = await this.documentClient.scan(params).promise();
            if (!data || !data.Items) {
                break
            }
            data.Items!.forEach(function (item) {
                resultArray.push(item.state)
            });
            notFinished = data.LastEvaluatedKey !== undefined;
            params = { ...params,
                ExclusiveStartKey: {
                    "id": data.LastEvaluatedKey?.id
                }
            }
        }
        const uniqueStrategies = [...new Set(resultArray.map(item => item.strategyDetails!.customName))];
        for (const strategy of uniqueStrategies) {
            const resultsByStrategy = resultArray.filter(strat => strat.strategyDetails!.customName === strategy);
            const totalProfitPercent = resultsByStrategy.map(state => state.profitPercent)
                .reduce((sum, current) => sum! + current!, 0)!
                .toFixed(2);
            const totalProfitBUSD = resultsByStrategy.map(state => state.profitMoney)
                .reduce((sum, current) => sum! + current!, 0);
            const wins = resultsByStrategy.filter(state => state.profitPercent! > 0).length;
            const losses = resultsByStrategy.length - wins;
            const profitable = losses === 0 ? 100 : (wins === 0 ? 0 : 100 - (losses/(wins + losses) * 100));
            res.push({
                strategy,
                totalProfitPercent: totalProfitPercent + "%",
                totalProfitBUSD: totalProfitBUSD?.toFixed(2) + " BUSD",
                wins,
                losses,
                profitable: profitable.toFixed(2) + "%"
            });
        }
        return res;
    }

    public async getTradingStates(email: string, startDate: string, endDate: string): Promise<Array<TradingState>> {
        let params: DynamoDB.DocumentClient.ScanInput = {
            ExpressionAttributeValues: {
                ':accountEmail' : email,
                ':startDate' : startDate,
                ':endDate' : endDate
            },
            ExpressionAttributeNames: {
                "#trading_state": "state"
            },
            FilterExpression: '#trading_state.accountEmail = :accountEmail and #trading_state.endDate between :startDate and :endDate',
            TableName: 'TradingStates'
        };
        const resultArray: MountainSeekerV2State[] = [];
        let notFinished = true;
        while (notFinished) {
            const data = await this.documentClient.scan(params).promise();
            if (!data || !data.Items) {
                break
            }
            data.Items!.forEach(function (item) {
                resultArray.push(item.state)
            });
            notFinished = data.LastEvaluatedKey !== undefined;
            params = { ...params,
                ExclusiveStartKey: {
                    "id": data.LastEvaluatedKey?.id
                }
            }
        }
        // newest states in the beginning of the array
        return resultArray.sort((s1, s2) => (s1.endDate! > s2.endDate! ? -1 : 1));
    }

    public async deleteTradingStates(email: string, startDate: string, endDate: string): Promise<number> {
        const itemsToDelete: Array<TradingState> = await this.getTradingStates(email, startDate, endDate);
        let deleted = 0;
        for (const item of itemsToDelete) {
            const params: DynamoDB.DocumentClient.DeleteItemInput = {
                TableName: 'TradingStates',
                Key: {
                    id : item.id
                }
            };
            await this.documentClient.delete(params).promise();
            deleted++;
        }
        log.debug(`Deleted ${deleted} states`);
        return deleted;
    }

    private createLocalAccountTable() {
        if(!this.configService.isSimulation() || AWS.config.endpoint.startsWith("https")) {
            return;
        }
        this.db.deleteTable({ TableName: "Accounts" }, (err: any, data: any) => {
            if (err) {
                log.warn("Unable to delete table:", JSON.stringify(err, null, 2));
            } else {
                log.debug("Deleted table:", JSON.stringify(data, null, 2));
            }
            const params = {
                TableName: "Accounts",
                KeySchema: [
                    { AttributeName: "email", KeyType: "HASH" }
                ],
                AttributeDefinitions: [
                    { AttributeName: "email", AttributeType: "S" }
                ],
                ProvisionedThroughput: {
                    ReadCapacityUnits: 1,
                    WriteCapacityUnits: 1
                }
            };
            this.db.createTable(params, (err: AWSError, data: DynamoDB.Types.CreateTableOutput) => {
                if (err) {
                    log.warn(`Unable to create table: ${JSON.stringify(err, null, 2)}`);
                } else {
                    log.debug(`Created table: ${JSON.stringify(data, null, 2)}`);
                }
            });
        });

        this.db.deleteTable({ TableName: "TradingStates" }, (err: any, data: any) => {
            if (err) {
                log.warn("Unable to delete table:", JSON.stringify(err, null, 2));
            } else {
                log.debug("Deleted table:", JSON.stringify(data, null, 2));
            }
            const params = {
                TableName: "TradingStates",
                KeySchema: [
                    { AttributeName: "id", KeyType: "HASH" }
                ],
                AttributeDefinitions: [
                    { AttributeName: "id", AttributeType: "S" }
                ],
                ProvisionedThroughput: {
                    ReadCapacityUnits: 1,
                    WriteCapacityUnits: 1
                }
            };
            this.db.createTable(params, (err: AWSError, data: DynamoDB.Types.CreateTableOutput) => {
                if (err) {
                    log.warn(`Unable to create table: ${JSON.stringify(err, null, 2)}`);
                } else {
                    log.debug(`Created table: ${JSON.stringify(data, null, 2)}`);
                }
            });
        });
    }

}

