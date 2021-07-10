import "reflect-metadata";
import express from "express";
const CONFIG = require('config').server;
import log from './logging/log.instance';
import { TradingService } from "./services/trading-service";
import { container } from "tsyringe";


const server = express();
const serverPort = process.env.PORT || CONFIG.port;

server.get('/', (req, res) =>  {
    res.send('Server is up');
});

server.get('/start', (req, res) =>  {
    res.send('Started');
    const tradingService = container.resolve(TradingService);
    tradingService.beginTrading().then(() => log.info("End"));
});

server.listen(serverPort, CONFIG.host, () => {
    log.info(`⛰ Server is running at ${CONFIG.host}:${serverPort}`);
    if (process.env.NODE_ENV !== "prod") {
        const tradingService = container.resolve(TradingService);
        tradingService.beginTrading().then(() => log.info("End"));
    }
});



