import express, { Request, Response } from 'express';
import { container } from "tsyringe";
import { DynamodbRepository } from "../repository/dynamodb-repository";
export const statisticsRoutes = express.Router();
const dynamodbRepository = container.resolve(DynamodbRepository);

statisticsRoutes.get("/stats", async (req: Request, res: Response) => {
    const user = req.query?.user;
    if (!user) {
        return res.status(400).json({
            message: `Provide a user`
        });
    }
    return res.status(200).json(await dynamodbRepository.getUserStats(user as string));
});