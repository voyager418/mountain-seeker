import express, { Request, Response } from 'express';
export const strategyRoutes = express.Router();

strategyRoutes.get("/test", async (req: Request, res: Response) => {
    return res.status(200).json({
        message: "fsdfjj"
    });
});