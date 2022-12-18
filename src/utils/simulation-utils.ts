import { Order } from "../models/order";
import { OrderType } from "../enums/order-type.enum";
import { Currency } from "../enums/trading-currencies.enum";
import { v4 as uuidv4 } from "uuid";
import { NumberUtils } from "./number-utils";
import { GlobalUtils } from "./global-utils";
import { MountainSeekerV2State } from "../strategies/state/mountain-seeker-v2-state";

interface SimulationData {
    statesInfo: any;
    globalInfo: {
        totalTrades: number
    };
}

export class SimulationUtils {

    public static getSimulatedMarketOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell",
        currentPrice: number, quoteAmount?: number, targetAmount?: number): Order {
        return {
            amountOfTargetAsset: side === "buy" ? NumberUtils.decreaseNumberByPercent(quoteAmount!, 0.1)/currentPrice :
                targetAmount!,
            datetime: GlobalUtils.getCurrentBelgianDate().toISOString(),
            externalId: "222",
            filled: side === "buy" ? NumberUtils.decreaseNumberByPercent(quoteAmount!, 0.1)/currentPrice :
                NumberUtils.decreaseNumberByPercent(targetAmount!, 0.1) * currentPrice,
            id: "111",
            originAsset,
            remaining: 0,
            side: side,
            status: "closed",
            targetAsset,
            type: OrderType.MARKET,
            average: currentPrice,
            amountOfOriginAsset: side === "sell" ? NumberUtils.decreaseNumberByPercent(targetAmount!, 0.1) * currentPrice :
                NumberUtils.decreaseNumberByPercent(quoteAmount!, 0.1)
        };
    }

    public static getSimulatedStopLimitOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell",
        stopPrice: number, limitPrice: number): Order {
        return {
            amountOfTargetAsset: 0,
            datetime: "",
            externalId: "444",
            filled: 0,
            id: "333",
            originAsset,
            stopPrice,
            limitPrice,
            remaining: 0,
            side: side,
            status: "open",
            targetAsset,
            type: OrderType.STOP_LIMIT,
            average: 200
        };
    }

    public static getSimulatedLimitOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell"): Order {
        return {
            amountOfTargetAsset: 0,
            datetime: "",
            externalId: "444",
            filled: 0,
            id: "333",
            originAsset,
            remaining: 0,
            side: side,
            status: "open",
            targetAsset,
            type: OrderType.LIMIT,
            average: 200
        };
    }

    public static getSimulatedGetOrder(originAsset: Currency, targetAsset: string): Order {
        return {
            amountOfTargetAsset: 0,
            datetime: "",
            externalId: "777",
            filled: 200,
            id: "555",
            originAsset,
            remaining: 0,
            side: "sell",
            status: "open",
            targetAsset,
            type: OrderType.STOP_LIMIT,
            average: 200
        };
    }

    public static getSimulatedCancelOrder(): Order {
        return {
            id: uuidv4(),
            externalId: "",
            filled: 0,
            remaining: 0,
            status: "canceled" as "open" | "closed" | "canceled",
            datetime: GlobalUtils.getCurrentBelgianDate().toISOString(),
            side: "sell" as "buy" | "sell",
            amountOfTargetAsset: 2,
            average: 200,
            originAsset: Currency.EUR,
            targetAsset: "BNB",
            type: OrderType.STOP_LIMIT
        };
    }

    static appendSimulationTradingInfo(states: Array<MountainSeekerV2State>, payload: any): SimulationData {
        const takeProfit = payload.findMaxProfit ? this.findTakeProfitForMaxProfit(states) : payload.takeProfit;
        const defaultDecreasePercent = payload.defaultDecreasePercent ? payload.defaultDecreasePercent : 0;
        const statesInfo = [];
        let cumulativeProfitPercent = 0;
        let cumulativeProfitMoney = payload.initialBalance;
        let nonProfitable = 0;
        for (let i = 0; i < states.length; i++) {
            cumulativeProfitPercent -= defaultDecreasePercent;
            if (takeProfit && states[i].runUp! >= takeProfit) {
                cumulativeProfitPercent += takeProfit;
                cumulativeProfitMoney = NumberUtils.increaseNumberByPercent(cumulativeProfitMoney, takeProfit - defaultDecreasePercent);
                if (payload.email === "simulation") { // TODO remove the if and create a completely new method for non simulation trades
                    states[i].profitPercent = takeProfit - defaultDecreasePercent;
                }
            } else {
                cumulativeProfitPercent += states[i].profitPercent!;
                const profit = states[i].profitPercent! - defaultDecreasePercent;
                if (profit <= 0) {
                    nonProfitable += 1;
                    cumulativeProfitMoney = NumberUtils.decreaseNumberByPercent(cumulativeProfitMoney, profit);
                } else {
                    cumulativeProfitMoney = NumberUtils.increaseNumberByPercent(cumulativeProfitMoney, profit);
                }
            }
            statesInfo.push({
                state: states[i],
                simulationInfo: {
                    cumulativeProfitPercent,
                    cumulativeProfitMoney: NumberUtils.truncateNumber(cumulativeProfitMoney, 2)
                }
            })
        }

        const globalInfo = {
            totalTrades: states.length,
            profitable: NumberUtils.truncateNumber(100 - nonProfitable/states.length * 100, 2),
            takeProfit: takeProfit,
            // below is for simulation only
            totalProfit: NumberUtils.truncateNumber(cumulativeProfitPercent, 2),
            simulationMoneyProfitPercent: NumberUtils.getPercentVariation(payload.initialBalance, cumulativeProfitMoney)
        };

        return {
            statesInfo,
            globalInfo
        };
    }

    private static findTakeProfitForMaxProfit(states: Array<MountainSeekerV2State>): number {
        let bestTakeProfit = 1;
        let cumulativeProfitPercent = -10000;

        for (let t = 1.0; t < 20; t += 0.1) {
            let tempCumulativeProfitPercent = 0;
            for (let i = 0; i < states.length; i++) {
                if (states[i].runUp! >= t) {
                    tempCumulativeProfitPercent += t;
                } else {
                    tempCumulativeProfitPercent += states[i].profitPercent!;
                }

                if (i == states.length - 1 && tempCumulativeProfitPercent > cumulativeProfitPercent) {
                    bestTakeProfit = t;
                    cumulativeProfitPercent = tempCumulativeProfitPercent;
                }

            }
        }

        return NumberUtils.truncateNumber(bestTakeProfit, 2);
    }

}