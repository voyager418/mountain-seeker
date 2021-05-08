import log from "../logging/log.instance";
import { Service } from "typedi";
const nodemailer = require('nodemailer');
const CONFIG = require('config');


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
        if (!CONFIG.simulation) {
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

