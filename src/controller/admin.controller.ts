import express from 'express';
import { container } from "tsyringe";
import { DynamodbRepository } from "../repository/dynamodb-repository";
import { TradingService } from "../services/trading-service";
import { SellService } from "../services/sell-service";
import { SimulationService } from "../services/simulation-service";
import { SimulationUtils } from "../utils/simulation-utils";

export const adminRoutes = express.Router();
const dynamodbRepository = container.resolve(DynamodbRepository);
const tradingService = container.resolve(TradingService);

adminRoutes.get('/api/stop/all', (req, res) =>  {
    res.send(tradingService.stopTrading());
});

adminRoutes.get('/api/start/all', (req, res) =>  {
    const totalObservers = tradingService.getStatus().total;
    if (totalObservers > 0) {
        return res.status(400).json({
            message: `Start was skipped because there are ${totalObservers} active observers`
        });
    }
    container.resolve(SellService).sellUnfinishedTrades()
        .then((accounts) => {
            tradingService.resumeTrading(accounts);
            container.resolve(SimulationService).startSimulations();
        })
        .catch((error) => {
            throw new Error(error);
        });
});

adminRoutes.get('/api/status', (req, res) =>  {
    res.send(tradingService.getStatus());
});

adminRoutes.post('/api/tradingstates/get', async (req, res) =>  {
    try {
        const states = await dynamodbRepository.getTradingStates(req.body);
        const response = SimulationUtils.appendSimulationTradingInfo(states, req.body); // TODO add if, if email not a simulation then call a different method
        return res.status(200).json(response);
    } catch (e) {
        return res.status(500).json({ errorMsg: new Error(e as any).message ?? e });
    }
});

adminRoutes.get('/api/tradingstates/delete', async (req, res) =>  {
    // return res.status(200).json(await dynamodbRepository.deleteTradingStates("abc", "2022-02-01T01:49:51.714Z", "2022-03-25T20:49:51.714Z"));
    return res.status(200).json(await dynamodbRepository.deleteTradingStates(req.body));
});