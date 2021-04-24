import "reflect-metadata";
import express from "express";
const CONFIG = require('config').server;
import log from './logging/log.instance';
import { TradingService } from "./services/trading-service";


const server = express();

server.get('/', (req, res) =>  {
    res.send('Server is up');
});

server.get('/start', (req, res) =>  {
    res.send('Started');
    const tradingService = new TradingService();
    tradingService.beginTrading().then(() => log.info("End"));
});

server.listen(CONFIG.port, CONFIG.host, () => {
    log.info(`⛰ Server is running at ${CONFIG.host}:${CONFIG.port}`);
    if (process.env.NODE_ENV !== "prod") {
        const tradingService = new TradingService();
        tradingService.beginTrading().then(() => log.info("End"));
    }
});



