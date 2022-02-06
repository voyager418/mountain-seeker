// import log from "../logging/log.instance";
// import { ConfigService } from "../services/config-service";
// import { Repository } from "./repository.interface";
// import { singleton } from "tsyringe";
// import { AWSError, DynamoDB } from "aws-sdk";
// const AWS = require("aws-sdk");
// import { Account } from "../models/account";
//
// /**
//  * Repository responsible to write data to and read data from the DynamoDB database
//  */
// @singleton()
// export class DynamodbRepository implements Repository {
//     private readonly db;
//     private readonly documentClient;
//
//     constructor(private configService: ConfigService) {
//         AWS.config.update({
//             region: configService.getConfig().aws.region,
//             endpoint: configService.getConfig().database.url
//         });
//         this.documentClient = new AWS.DynamoDB.DocumentClient();
//         this.db = new AWS.DynamoDB();
//         if (configService.isSimulation()) {
//             this.createLocalAccountTable();
//         }
//     }
//
//     public updateAccount(account: Account): void {
//         const params = {
//             TableName: "Accounts",
//             Item: {
//                 email: account.email,
//                 account
//             }
//         };
//         this.documentClient.put(params, (err: AWSError) => {
//             if (err) {
//                 log.error(`Unable to add item: ${JSON.stringify(err)}`);
//             } else {
//                 log.debug("Updated account %O", account.email);
//             }
//         });
//     }
//
//     private createLocalAccountTable() {
//         if(!this.configService.isSimulation()) {
//             return;
//         }
//         this.db.deleteTable({ TableName: "Accounts" }, (err: any, data: any) => {
//             if (err) {
//                 log.warn("Unable to delete table:", JSON.stringify(err, null, 2));
//             } else {
//                 log.debug("Deleted table:", JSON.stringify(data, null, 2));
//             }
//             const params = {
//                 TableName: "Accounts",
//                 KeySchema: [
//                     { AttributeName: "email", KeyType: "HASH" }
//                 ],
//                 AttributeDefinitions: [
//                     { AttributeName: "email", AttributeType: "S" }
//                 ],
//                 ProvisionedThroughput: {
//                     ReadCapacityUnits: 1,
//                     WriteCapacityUnits: 1
//                 }
//             };
//             this.db.createTable(params, (err: AWSError, data: DynamoDB.Types.CreateTableOutput) => {
//                 if (err) {
//                     log.warn(`Unable to create table: ${JSON.stringify(err, null, 2)}`);
//                 } else {
//                     log.debug(`Created table: ${JSON.stringify(data, null, 2)}`);
//                 }
//             });
//         });
//     }
//
// }
//
