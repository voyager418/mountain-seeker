/**
 * Represents trading progress state and statistics
 */
import { Strategy } from "../../models/strategy";
import { MountainSeekerV2Config } from "../config/mountain-seeker-v2-config";

export type TradingState = {
    /** Identifier of the trading strategy that is being executed */
    id: string;
    /** Link to the account */
    accountEmail: string;
    /** The market where the trading is happening */
    marketSymbol?: string;
    /** All details of the strategy that was used */
    strategyDetails?: Strategy<MountainSeekerV2Config>;
}