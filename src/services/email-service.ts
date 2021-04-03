import log from "../logging/log.instance";
import { Service } from "typedi";
const nodemailer = require('nodemailer');


@Service()
export class EmailService {
    private transporter;

    constructor() {
        this.transporter = nodemailer.createTransport({
            service: process.env.EMAIL_PROVIDER,
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    public async sendEmail(subject: string, text: string): Promise<void> {
        try {
            await this.transporter.sendMail({
                from: `"MS 🏔" <aa>`, // sender address
                to: process.env.EMAIL_ADDRESS, // list of receivers
                subject: subject,
                text: text
            });
        } catch (e) {
            log.warn("Failed to send mail:", e);
        }
    }
}

