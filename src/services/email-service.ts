import log from "../logging/log.instance";
import { Container, Service } from "typedi";
const nodemailer = require('nodemailer');


@Service()
export class EmailService {
    private transporter;
    private static IS_SIMULATION: false;

    constructor() {
        EmailService.IS_SIMULATION = Container.get("IS_SIMULATION");
        this.transporter = nodemailer.createTransport({
            service: process.env.EMAIL_PROVIDER,
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASS
            }
        });
    }

    public async sendEmail(subject: string, text: string): Promise<void> {
        if(!EmailService.IS_SIMULATION) {
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
    }
}

