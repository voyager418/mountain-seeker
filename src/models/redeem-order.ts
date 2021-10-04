export type RedeemOrder = {
    /** ID generated by the trading platform */
    externalId: string,
    status: "S" | "P" | "F",
    targetAsset: string,
    redeemAmount: number,
    amount: number,
    timestamp: number
}