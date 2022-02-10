import log from "../logging/log.instance";
import { ConfigService } from "../services/config-service";
import { singleton } from "tsyringe";
import { AWSError, DynamoDB } from "aws-sdk";
const AWS = require("aws-sdk");
import { Account } from "../models/account";
import { MountainSeekerV2State } from "../strategies/state/mountain-seeker-v2-state";

/**
 * Repository responsible to write data to and read data from the DynamoDB database
 */
@singleton()
export class DynamodbRepository {
    private readonly db;
    private readonly documentClient;

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

    public updateAccount(account: Account): void {
        const params = {
            TableName: "Accounts",
            Item: {
                email: account.email,
                account
            }
        };
        this.documentClient.put(params, (err: AWSError) => {
            if (err) {
                log.error(`Unable to add item: ${JSON.stringify(err)}`);
            } else {
                log.debug("Updated account %O", account.email);
            }
        });
    }

    public addState(state: MountainSeekerV2State): void {
        if (this.configService.isSimulation()) {
            state.drawDown = undefined;
            state.runUp = undefined;
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

    private createLocalAccountTable() {
        if(!this.configService.isSimulation()) {
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

