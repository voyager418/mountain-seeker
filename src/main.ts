import "reflect-metadata";
import express from "express";
const CONFIG = require('config').server;
import log from './logging/log.instance';
import { TradingService } from "./services/trading-service";
import { container } from "tsyringe";
import { SellService } from "./services/sell-service";
import { SimulationService } from "./services/simulation-service";
import { statisticsRoutes } from "./controller/statistics.controller";
import { ConfigService } from "./services/config-service";
import { adminRoutes } from "./controller/admin.controller";


const server = express();
const path = require('path');
const serverPort = CONFIG.port;
const serverHost = CONFIG.host;
server.use(express.json())
server.use(adminRoutes);
server.use(statisticsRoutes);
server.use(express.static(path.join(__dirname, '../ui/dist')));

server.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../ui/dist/index.html'));
});

server.listen(serverPort, serverHost, () => {
    log.info(`⛰ Server is running at ${serverHost}:${serverPort}`);
    if (container.resolve(ConfigService).isSimulation()) {
        container.resolve(SimulationService).startSimulations();
    } else {
        container.resolve(SellService).sellUnfinishedTrades()
            .then((accounts) => {
                container.resolve(TradingService).resumeTrading(accounts);
                container.resolve(SimulationService).startSimulations();
            })
            .catch((error) => {
                throw new Error(error);
            });
    }
});



