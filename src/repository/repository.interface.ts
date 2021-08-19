import { Market } from "../models/market";

export interface Repository {
    putMarket(market: Market): void;
}