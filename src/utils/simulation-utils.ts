import { Order } from "../models/order";
import { OrderType } from "../enums/order-type.enum";
import { Currency } from "../enums/trading-currencies.enum";

export class SimulationUtils {
    private constructor() {
        // utility class
    }

    public static getSimulatedMarketOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell"): Order {
        return {
            amountOfTargetAsset: 0,
            datetime: "",
            externalId: "222",
            filled: 0,
            id: "111",
            originAsset,
            remaining: 0,
            side: side,
            status: "open",
            targetAsset,
            type: OrderType.MARKET,
            average: 200
        };
    }

    public static getSimulatedStopLimitOrder(originAsset: Currency, targetAsset: string, side: "buy" | "sell"): Order {
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
            type: OrderType.STOP_LIMIT,
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
            status: "closed",
            targetAsset,
            type: OrderType.STOP_LIMIT,
            average: 200
        };
    }
}