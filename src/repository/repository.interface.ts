import { Account } from "../models/account";

export interface Repository {
    /** Creates or updates an account */
    updateAccount(account: Account): void;
}