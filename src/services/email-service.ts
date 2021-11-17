import log from "../logging/log.instance";
import { ConfigService } from "./config-service";
import { singleton } from "tsyringe";
import { Market } from "../models/market";
import { StrategyUtils } from "../utils/strategy-utils";
import { GlobalUtils } from "../utils/global-utils";
const nodemailer = require('nodemailer');


@singleton()
export class EmailService {
    private transporter;

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            service: process.env.EMAIL_PROVIDER,
            auth: {
                user: process.env.PROVIDER_EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    public async sendEmail(subject: string, text: string): Promise<void> {
        if (!this.configService.isSimulation()) {
            try {
                await this.transporter.sendMail({
                    from: `"MS 🏔" <${process.env.PROVIDER_EMAIL_ADDRESS}>`, // sender address
                    to: process.env.RECEIVER_EMAIL_ADDRESS, // list of receivers
                    subject: subject,
                    text: text
                });
            } catch (e) {
                log.warn("Failed to send mail : ", e);
            }
        }
        return Promise.resolve();
    }

    public async sendInitialEmail(market: Market, investedAmount: number,
        stopLossPrice: number, takeProfitPrice: number, averageFilledPrice: number, initialWalletBalance: Map<string, number>): Promise<void> {
        if (!this.configService.isSimulation()) {
            let text = "Portefeuille initial :\n";
            for (const [key, value] of initialWalletBalance) {
                text += "    " + key + " : " + value + "\n";
            }
            text += "\nSomme investie : " + investedAmount + " " + market.originAsset + "\n";
            text += "Prix stop loss : " + stopLossPrice + "\n";
            text += "Prix take profit : " + GlobalUtils.truncateNumber(takeProfitPrice, market.pricePrecision!) + "\n";
            text += "Prix moyen d'achat : " + GlobalUtils.truncateNumber(averageFilledPrice, market.pricePrecision!) + " " + market.originAsset + "\n";
            text += `Perte maximum ≈ ${StrategyUtils.getPercentVariation(averageFilledPrice, GlobalUtils.decreaseNumberByPercent(stopLossPrice, 0.1)).toFixed(2)}%\n`;
            text += `Gain maximum ≈ +${StrategyUtils.getPercentVariation(averageFilledPrice, GlobalUtils.decreaseNumberByPercent(takeProfitPrice, 0.1)).toFixed(2)}%`;

            try {
                await this.transporter.sendMail({
                    from: `"MS 🏔" <${process.env.PROVIDER_EMAIL_ADDRESS}>`, // sender address
                    to: process.env.RECEIVER_EMAIL_ADDRESS, // list of receivers
                    subject: `Trading started on ${market.symbol}`,
                    text: text
                });
            } catch (e) {
                log.error("Failed to send initial mail : ", e);
            }
        }
        return Promise.resolve();
    }

    public async sendFinalMail(market: Market, investedAmount: number,
        retrievedAmount: number, profit: number, profitPercent: number, initialWalletBalance: Map<string, number>,
        endWalletBalance: Map<string, number>): Promise<void> {
        if (!this.configService.isSimulation()) {
            let text = "Portefeuille initial :\n";
            for (const [key, value] of initialWalletBalance) {
                text += "    " + key + " : " + value + "\n";
            }
            text += "Portefeuille final :\n";
            for (const [key, value] of endWalletBalance) {
                text += "    " + key + " : " + value + "\n";
            }
            const plusPrefix = profitPercent > 0 ? '+' : '';
            text += "\nSomme investie : " + investedAmount + " " + market.originAsset + "\n";
            text += "Somme récupérée : " + retrievedAmount + " " + market.originAsset + "\n";
            text += `Changement : ${plusPrefix}${profitPercent.toFixed(2)}%\n`;

            try {
                await this.transporter.sendMail({
                    from: `"MS 🏔" <${process.env.PROVIDER_EMAIL_ADDRESS}>`, // sender address
                    to: process.env.RECEIVER_EMAIL_ADDRESS, // list of receivers
                    subject:`Trading finished on ${market!.symbol} (${plusPrefix}${profitPercent.toFixed(2)}%, ${plusPrefix}${profit.toFixed(2)} ${market.originAsset})`,
                    text: text
                });
            } catch (e) {
                log.error("Failed to send final mail : ", e);
            }
        }
        return Promise.resolve();
    }
}

