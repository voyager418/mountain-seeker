
/**
 * Represents user's trading account
 */
export type Account = {
    /** API key to authenticate with the trading platform */
    apiKey?: string;
    /** API secret to authenticate with the trading platform */
    apiSecret?: string
    firstName?: string;
    lastName?: string;
    bankAccountNumber?: string;
    cryptoWalletAccountNumber?: string;
}
