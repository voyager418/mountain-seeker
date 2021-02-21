import "reflect-metadata";
import express from "express";
const CONFIG = require('config').server;
import log from './logging/log.instance';
import { TradingService } from "./services/trading-service";


const server = express();

server.get('/', (req, res) =>  {
    res.send('Server is up');
});

server.listen(CONFIG.port, CONFIG.host, () => {
    log.info(`⛰ Server is running at http://${CONFIG.host}:${CONFIG.port}`);
    const tradingService = new TradingService();
    tradingService.beginTrading();
});



