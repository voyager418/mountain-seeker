import { OrderType } from "../enums/order-type.enum";
import { OrderAction } from "../enums/order-action.enum";
import { Currency } from "../enums/trading-currencies.enum";

export type Order = {
    id: string,
    action: OrderAction
    type: OrderType,
    originAsset: Currency,
    targetAsset: string,
    amount: number,
    status?: 'open' | 'closed' | 'canceled';
    datetime?: string;
    info?: unknown;
}