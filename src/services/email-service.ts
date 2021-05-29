import log from "../logging/log.instance";
import { Service } from "typedi";
import { ConfigService } from "./config-service";
const nodemailer = require('nodemailer');
const CONFIG = require('config');


@Service()
export class EmailService {
    private transporter;

    constructor(private configService: ConfigService) {
        this.transporter = nodemailer.createTransport({
            service: process.env.EMAIL_PROVIDER,
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    public async sendEmail(subject: string, text: string): Promise<void> {
        if (!this.configService.isSimulation()) {
            try {
                await this.transporter.sendMail({
                    from: `"MS 🏔" <${process.env.EMAIL_ADDRESS}>`, // sender address
                    to: process.env.EMAIL_ADDRESS, // list of receivers
                    subject: subject,
                    text: text
                });
            } catch (e) {
                log.warn("Failed to send mail : ", e);
            }
        }
        return Promise.resolve();
    }
}

