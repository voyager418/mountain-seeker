import express from 'express';
import { container } from "tsyringe";
import { DynamodbRepository } from "../repository/dynamodb-repository";
import { TradingService } from "../services/trading-service";
import { SellService } from "../services/sell-service";
import { SimulationService } from "../services/simulation-service";
export const adminRoutes = express.Router();
const dynamodbRepository = container.resolve(DynamodbRepository);

adminRoutes.get('/', (req, res) =>  {
    res.send('Server is up');
});

adminRoutes.get('/stop/all', (req, res) =>  {
    const tradingService = container.resolve(TradingService);
    res.send(tradingService.stopTrading());
});

adminRoutes.get('/start/all', (req, res) =>  {
    const totalObservers = container.resolve(TradingService).getStatus().total;
    if (totalObservers > 0) {
        return res.status(400).json({
            message: `Start was skipped because there are ${totalObservers} active observers`
        });
    }
    container.resolve(SellService).sellUnfinishedTrades()
        .then((accounts) => {
            container.resolve(TradingService).resumeTrading(accounts);
            container.resolve(SimulationService).startSimulations();
        })
        .catch((error) => {
            throw new Error(error);
        });
});

adminRoutes.get('/status', (req, res) =>  {
    const tradingService = container.resolve(TradingService);
    res.send(tradingService.getStatus());
});

adminRoutes.post('/tradingstates/get', async (req, res) =>  {
    const body = req.body;
    return res.status(200).json(await dynamodbRepository.getTradingStates(body.email, body.startDate, body.endDate));
});

adminRoutes.get('/tradingstates/delete', async (req, res) =>  {
    return res.status(200).json(await dynamodbRepository.deleteTradingStates("abc", "2022-02-01T01:49:51.714Z", "2022-03-25T20:49:51.714Z"));
});