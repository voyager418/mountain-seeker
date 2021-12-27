// import log from "../logging/log.instance";
// import { ConfigService } from "../services/config-service";
// import { Repository } from "./repository.interface";
// import { singleton } from "tsyringe";
// import { AWSError, DynamoDB } from "aws-sdk";
// import { Market } from "../models/market";
// const AWS = require("aws-sdk");
//
// /**
//  * Repository responsible to write data to and read data from the Dynamodb database
//  */
// @singleton()
// export class DynamodbRepository implements Repository {
//     private readonly db;
//     private documentClient;
//
//     constructor(private configService: ConfigService) {
//         if (configService.isSimulation()) {
//
//             AWS.config.update({
//                 region: configService.getConfig().aws.region,
//                 endpoint: configService.getConfig().database.url
//             });
//             this.documentClient = new AWS.DynamoDB.DocumentClient();
//
//             // if (configService.isSimulation()) {
//             this.db = new AWS.DynamoDB();
//             this.createLocalTables();
//         }
//     }
//
//     public putMarket(market: Market): void {
//         const params = {
//             TableName: "Markets",
//             Item: {
//                 "name": market.symbol,
//                 "last24Change": market.percentChangeLast24h,
//                 market
//             }
//         };
//
//         this.documentClient.put(params, (err: AWSError) => {
//             if (err) {
//                 log.error(`Unable to add item. Error JSON: ${JSON.stringify(err, null, 2)}`);
//             }
//         });
//     }
//
//     private createLocalTables() {
//         // this.db.deleteTable({ TableName: "Markets" }, (err: any, data: any) => {
//         //     if (err) {
//         //         console.error("Unable to delete table. Error JSON:", JSON.stringify(err, null, 2));
//         //     } else {
//         //         console.log("Deleted table. Table description JSON:", JSON.stringify(data, null, 2));
//         //     }
//         // });
//         const params = {
//             TableName: "Markets",
//             KeySchema: [
//                 { AttributeName: "name", KeyType: "HASH" }
//             ],
//             AttributeDefinitions: [
//                 { AttributeName: "name", AttributeType: "S" }
//             ],
//             ProvisionedThroughput: {
//                 ReadCapacityUnits: 1,
//                 WriteCapacityUnits: 1
//             }
//         };
//
//         this.db.createTable(params, (err: AWSError, data: DynamoDB.Types.CreateTableOutput) => {
//             if (err) {
//                 log.warn(`Unable to create table : ${JSON.stringify(err, null, 2)}`);
//             } else {
//                 log.info(`Created table. Table description : ${JSON.stringify(data, null, 2)}`);
//             }
//         });
//     }
//
// }
//
