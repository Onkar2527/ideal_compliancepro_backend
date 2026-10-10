import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.initTransporter();
  }

  private initTransporter() {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = Number(this.configService.get<number>('SMTP_PORT') || 587);
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    this.logger.log(`[EmailService] Initializing SMTP Transporter for host: "${host}", port: ${port}, user: "${user}"`);

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // true for 465, false for other ports (e.g. 587 uses STARTTLS)
      auth: {
        user,
        pass,
      },
    });
  }

  async sendMail(
    to: string,
    subject: string,
    text: string,
    html?: string,
  ): Promise<boolean> {
    const isExplicitlyDisabled = this.configService.get<string>('EMAIL_NOTIFICATIONS_ENABLED') === 'false';
    if (isExplicitlyDisabled) {
      this.logger.warn(`[EmailService] Email notifications explicitly disabled in .env. Skipping email to ${to}`);
      return true;
    }

    const fromEmail = this.configService.get<string>('SMTP_FROM_EMAIL');
    const fromName = this.configService.get<string>('SMTP_FROM_NAME') || 'Compliance Pro Security';

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to,
      subject,
      text,
      html: html || text,
    };

    try {
      this.logger.log(
        `[EmailService] Sending email to "${to}" via ${this.configService.get<string>('SMTP_HOST')} (Subject: "${subject}")...`,
      );
      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(
        `[EmailService] SMTP sendMail success! Message ID: ${info.messageId}, Response: ${info.response}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `[EmailService] Failed to send email to "${to}":`,
        error,
      );
      throw new Error(`Email sending failed: ${error.message}`);
    }
  }
}
