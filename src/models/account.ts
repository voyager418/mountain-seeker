import { Strategy, StrategyName } from "./strategy";
import { Currency } from "../enums/trading-currencies.enum";

/**
 * Represents user's trading account
 */
export type Account = {
    email: string;
    password?: string;
    /** Maximum amount of money that this user is allowed to invest */
    maxMoneyAmount: number;
    /** API key to authenticate with the trading platform */
    apiKey: string;
    /** API secret to authenticate with the trading platform */
    apiSecret: string;
    /** If the trading is enabled for this account */
    isActive: boolean;
    mailPreferences: {
        onNewTrade?: boolean;
        onEndTrade?: boolean;
    };
    activeStrategies: Array<StrategyName>;
    runningState?: {
        strategy: Strategy<any>;
        amountOfTargetAssetThatWasBought: number
        marketOriginAsset: Currency,
        marketTargetAsset: string
    };
    stats?: AccountStats;
}

export enum Emails {
    SIMULATION = "simulation"
}

export type AccountStats = {
    cumulativeProfitPercent: number;
    cumulativeProfitBUSD: number;
    wins: number;
    losses: number;
}