import "reflect-metadata";
import express from "express";
const CONFIG = require('config').server;
import log from './logging/log.instance';
import { TradingService } from "./services/trading-service";
import { container } from "tsyringe";
import { SellService } from "./services/sell-service";
import { SimulationService } from "./services/simulation-service";
import { statisticsRoutes } from "./controller/statistics.controller";


const server = express();
const serverPort = CONFIG.port;
const serverHost = CONFIG.host;

server.get('/', (req, res) =>  {
    res.send('Server is up');
});

server.get('/stop/all', (req, res) =>  {
    const tradingService = container.resolve(TradingService);
    res.send(tradingService.stopTrading());
});

server.get('/start/all', (req, res) =>  {
    container.resolve(SellService).sellUnfinishedTrades()
        .then((accounts) => {
            container.resolve(TradingService).resumeTrading(accounts);
            container.resolve(SimulationService).startSimulations();
        })
        .catch((error) => {
            throw new Error(error);
        });
});

server.get('/status', (req, res) =>  {
    const tradingService = container.resolve(TradingService);
    res.send(tradingService.getStatus());
});

server.use(statisticsRoutes);

server.listen(serverPort, serverHost, () => {
    log.info(`⛰ Server is running at ${serverHost}:${serverPort}`);
    container.resolve(SellService).sellUnfinishedTrades()
        .then((accounts) => {
            container.resolve(TradingService).resumeTrading(accounts);
            container.resolve(SimulationService).startSimulations();
        })
        .catch((error) => {
            throw new Error(error);
        });
});



