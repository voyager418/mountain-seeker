import "reflect-metadata";
import express from "express";
const CONFIG = require('config').server;
import log from './logging/log.instance';
import { TradingService } from "./services/trading-service";
import { container } from "tsyringe";


const server = express();
const serverPort = CONFIG.port;
const serverHost = CONFIG.host;

server.get('/', (req, res) =>  {
    res.send('Server is up');
});

server.get('/start', (req, res) =>  {
    res.send('Started');
    const tradingService = container.resolve(TradingService);
    tradingService.beginTrading();
});

server.get('/stop', (req, res) =>  {
    const tradingService = container.resolve(TradingService);
    res.send(tradingService.stopTrading());
});

server.listen(serverPort, serverHost, () => {
    log.info(`⛰ Server is running at ${serverHost}:${serverPort}`);
    if (process.env.NODE_ENV !== "prod") {
        const tradingService = container.resolve(TradingService);
        tradingService.beginTrading();
    }
});



