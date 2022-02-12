import "reflect-metadata";
import express from "express";
const CONFIG = require('config').server;
import log from './logging/log.instance';
import { TradingService } from "./services/trading-service";
import { container } from "tsyringe";
import { SimulationService } from "./services/simulation-service";


const server = express();
const serverPort = CONFIG.port;
const serverHost = CONFIG.host;

server.get('/', (req, res) =>  {
    res.send('Server is up');
});

server.get('/stop', (req, res) =>  {
    const tradingService = container.resolve(TradingService);
    res.send(tradingService.stopTrading());
});

server.get('/status', (req, res) =>  {
    const tradingService = container.resolve(TradingService);
    res.send(tradingService.getStatus());
});

server.listen(serverPort, serverHost, () => {
    log.info(`⛰ Server is running at ${serverHost}:${serverPort}`);

    container.resolve(SimulationService).startSimulations();
});



