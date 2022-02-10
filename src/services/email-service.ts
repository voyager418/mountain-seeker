import log from "../logging/log.instance";
import { ConfigService } from "./config-service";
import { singleton } from "tsyringe";
import { Market } from "../models/market";
import { StrategyDetails } from "../models/strategy-details";
import { NumberUtils } from "../utils/number-utils";
import { GlobalUtils } from "../utils/global-utils";
import { Order } from "../models/order";
import { MountainSeekerV2State } from "../strategies/state/mountain-seeker-v2-state";
import { Account } from "../models/account";

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

    public async sendEmail(to: string, subject: string, emailText: string): Promise<void> {
        if (!this.configService.isSimulation()) {
            let retries = 5;
            let errorMessage;
            while (retries-- > 0) {
                try {
                    await this.transporter.sendMail({
                        from: `"MS 🏔" <${process.env.PROVIDER_EMAIL_ADDRESS}>`, // sender address
                        to: process.env.ADMIN_EMAIL, // list of receivers
                        subject: subject,
                        text: emailText
                    });
                    return Promise.resolve();
                } catch (e) {
                    errorMessage = (e as any).message;
                    await GlobalUtils.sleep(NumberUtils.randomNumber(2, 60));
                }
            }
            log.error(`Failed to send mail: ${JSON.stringify(errorMessage)}. The text was: ${JSON.stringify(emailText)}`);
        }
        return Promise.resolve();
    }

    public async sendInitialEmail(account: Account, strategy: StrategyDetails<any>, state: MountainSeekerV2State, market: Market, investedAmount: number,
        averageFilledPrice: number, initialWalletBalance: Map<string, number>): Promise<void> {
        if (!this.configService.isSimulation() && account.mailPreferences.onNewTrade) {
            let emailText = "Portefeuille initial :\n";
            for (const [key, value] of initialWalletBalance) {
                emailText += "    " + key + " : " + value + "\n";
            }
            emailText += "\nSomme investie : " + investedAmount + " " + market.originAsset + "\n";
            emailText += "Prix moyen d'achat : " + NumberUtils.truncateNumber(averageFilledPrice, market.pricePrecision!) + " " + market.originAsset + "\n";
            emailText += `Stratégie : ${strategy.type + (strategy.customName ? "-" + strategy.customName : "")}\n`;
            emailText += `Unique ID : ${state.id}\n`;

            let retries = 5;
            let errorMessage;
            while (retries-- > 0) {
                try {
                    await this.transporter.sendMail({
                        from: `"MS 🏔" <${process.env.PROVIDER_EMAIL_ADDRESS}>`, // sender address
                        to: process.env.ADMIN_EMAIL, // list of receivers
                        subject: `Trading started on ${market.symbol} (${strategy.customName})`,
                        text: emailText
                    });
                    return Promise.resolve();
                } catch (e) {
                    errorMessage = (e as any).message;
                    await GlobalUtils.sleep(NumberUtils.randomNumber(2, 60));
                }
            }
            log.error(`Failed to send initial mail: ${JSON.stringify(errorMessage)}. The text was: ${JSON.stringify(emailText)}`);
        }
        return Promise.resolve();
    }

    public async sendFinalMail(account: Account, strategy: StrategyDetails<any>, state: MountainSeekerV2State, market: Market,
        investedAmount: number, lastOrder: Order, initialWalletBalance: Map<string, number>,
        endWalletBalance: Map<string, number>): Promise<void> {
        if (!this.configService.isSimulation() && account.mailPreferences.onEndTrade) {
            let emailText = "Portefeuille initial :\n";
            for (const [key, value] of initialWalletBalance) {
                emailText += "    " + key + " : " + value + "\n";
            }
            emailText += "Portefeuille final :\n";
            for (const [key, value] of endWalletBalance) {
                emailText += "    " + key + " : " + value + "\n";
            }
            const plusPrefix = state.profitPercent! > 0 ? '+' : "";
            emailText += "\nSomme investie : " + investedAmount + " " + market.originAsset + "\n";
            emailText += "Somme récupérée : " + state.retrievedAmountOfBusd + " " + market.originAsset + "\n";
            emailText += `Changement : ${plusPrefix}${state.profitPercent}%\n`;
            emailText += `Run-up : ${state.runUp}%\n`;
            emailText += `Drawdown : ${state.drawDown}%\n`;
            emailText += `Date de fin : ${lastOrder.datetime}\n`;
            emailText += `Stratégie : ${strategy.type + (strategy.customName ? "-" + strategy.customName : "")}\n`;
            emailText += `Unique ID : ${state.id}\n`;

            let retries = 5;
            let errorMessage;
            while (retries-- > 0) {
                try {
                    await this.transporter.sendMail({
                        from: `"MS 🏔" <${process.env.PROVIDER_EMAIL_ADDRESS}>`, // sender address
                        to: process.env.ADMIN_EMAIL, // list of receivers
                        subject: `Trading finished on ${market!.symbol} (${plusPrefix}${state.profitPercent}%, ${plusPrefix}${state.profitMoney} ${market.originAsset}) (${strategy.customName})`,
                        text: emailText
                    });
                    return Promise.resolve();
                } catch (e) {
                    errorMessage = (e as any).message;
                    await GlobalUtils.sleep(NumberUtils.randomNumber(2, 60));
                }
            }
            log.error(`Failed to send final mail: ${JSON.stringify(errorMessage)}. The text was: ${JSON.stringify(emailText)}`);
        }
        return Promise.resolve();
    }
}

