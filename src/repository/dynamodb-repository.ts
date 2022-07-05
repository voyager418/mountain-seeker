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

    public saveState(state: MountainSeekerV2State): void {
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

    public async getTradingStates(payload: any): Promise<Array<TradingState>> {
        if (!payload.email || !payload.startDate || !payload.endDate || !payload.strategyName) {
            return Promise.reject("One of the mandatory fields is missing");
        }
        let params: DynamoDB.DocumentClient.ScanInput = {
            ExpressionAttributeValues: {
                ':accountEmail' : payload.email,
                ':startDate' : payload.startDate,
                ':endDate' : payload.endDate,
                ':strategyName' : payload.strategyName,
                ':volumeRatioLower': payload.volumeRatio ? payload.volumeRatio[0] : 0,
                ':volumeRatioUpper': payload.volumeRatio ? payload.volumeRatio[1] : 2000,
                ':c1VariationLower': payload.c1Variation ? payload.c1Variation[0] : 0,
                ':c1VariationUpper': payload.c1Variation ? payload.c1Variation[1] : 2000,
                ':c2VariationLower': payload.c2Variation ? payload.c2Variation[0] : 0,
                ':c2VariationUpper': payload.c2Variation ? payload.c2Variation[1] : 2000,
                ':chg24hLower': payload.chg24h ? payload.chg24h[0] : -20,
                ':chg24Upper': payload.chg24h ? payload.chg24h[1] : 2000,
                ':volumeBUSD5hLower': payload.volumeBUSD5h ? payload.volumeBUSD5h[0] : 40000,
                ':volumeBUSD5hUpper': payload.volumeBUSD5h ? payload.volumeBUSD5h[1] : 100000000,
                ':edgeVariationLower': payload.edgeVariation ? payload.edgeVariation[0] : -1000,
                ':edgeVariationUpper': payload.edgeVariation ? payload.edgeVariation[1] : 1000,
                ':maxVariationLower': payload.maxVariation ? payload.maxVariation[0] : -1000,
                ':maxVariationUpper': payload.maxVariation ? payload.maxVariation[1] : 1000,
                ':c1MaxVarRatioLower': payload.c1MaxVarRatio ? payload.c1MaxVarRatio[0] : -1000,
                ':c1MaxVarRatioUpper': payload.c1MaxVarRatio ? payload.c1MaxVarRatio[1] : 1000
            },
            ExpressionAttributeNames: {
                "#trading_state": "state"
            },
            FilterExpression: '#trading_state.accountEmail = :accountEmail and ' +
                '#trading_state.endDate between :startDate and :endDate and ' +
                '#trading_state.strategyDetails.customName = :strategyName and ' +
                '#trading_state.strategyDetails.metadata.volumeRatio between :volumeRatioLower and :volumeRatioUpper and ' +
                '#trading_state.last5CandleSticksPercentageVariations[3] between :c1VariationLower and :c1VariationUpper and ' +
                '#trading_state.last5CandleSticksPercentageVariations[2] between :c2VariationLower and :c2VariationUpper and ' +
                '#trading_state.marketPercentChangeLast24h between :chg24hLower and :chg24Upper and ' +
                '#trading_state.strategyDetails.metadata.edgeVariation between :edgeVariationLower and :edgeVariationUpper and ' +
                '#trading_state.strategyDetails.metadata.maxVariation between :maxVariationLower and :maxVariationUpper and ' +
                '#trading_state.strategyDetails.metadata.c1MaxVarRatio between :c1MaxVarRatioLower and :c1MaxVarRatioUpper and ' +
                '#trading_state.strategyDetails.metadata.BUSDVolumeLast5h between :volumeBUSD5hLower and :volumeBUSD5hUpper',
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
        // newest states in the end of the array
        return resultArray.sort((s1, s2) => (s1.endDate! < s2.endDate! ? -1 : 1));
    }

    public async deleteTradingStates(payload: any): Promise<number> {
        const itemsToDelete: Array<TradingState> = await this.getTradingStates(payload);
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

