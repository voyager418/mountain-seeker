import { Order } from "../models/order";
import { OrderType } from "../enums/order-type.enum";
import { Currency } from "../enums/trading-currencies.enum";
import { v4 as uuidv4 } from "uuid";
import { NumberUtils } from "./number-utils";

export class SimulationUtils {

    public static getSimulatedMarketOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell",
        currentPrice: number, quoteAmount?: number, targetAmount?: number): Order {
        return {
            amountOfTargetAsset: side === "buy" ? NumberUtils.decreaseNumberByPercent(quoteAmount!, 0.1)/currentPrice :
                targetAmount!,
            datetime: "",
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
            datetime: "",
            side: "sell" as "buy" | "sell",
            amountOfTargetAsset: 2,
            average: 200,
            originAsset: Currency.EUR,
            targetAsset: "BNB",
            type: OrderType.STOP_LIMIT
        };
    }
}