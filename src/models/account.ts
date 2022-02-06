
/**
 * Represents user's trading account
 */
export type Account = {
    email: string;
    password?: string;
    /** Maximum amount of money that this user is allowed to invest */
    maxMoneyAmount: number;
    /** API key to authenticate with the trading platform */
    apiKey?: string;
    /** API secret to authenticate with the trading platform */
    apiSecret?: string;
    /** If the trading is enabled for this account */
    isActive?: boolean;
    mailPreferences: {
        onNewTrade?: boolean;
        onEndTrade?: boolean;
    }
}
