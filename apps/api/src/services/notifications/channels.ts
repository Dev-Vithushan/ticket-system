import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../../config/env';
import { logger } from '../../lib/logger';

export interface OutboundMessage {
  to: { email: string; name: string };
  subject: string;
  text: string;
  link?: string;
}

/** A delivery channel beyond in-app notifications (email, chat, SMS…). */
export interface NotificationChannel {
  readonly name: string;
  isEnabled(): boolean;
  send(messages: OutboundMessage[]): Promise<void>;
}

/** SMTP channel — works with any SMTP server or transactional provider's SMTP relay (SES, SendGrid, Postmark…). */
export class SmtpEmailChannel implements NotificationChannel {
  readonly name = 'email';
  private transporter: Transporter | null = null;

  isEnabled() {
    return Boolean(config.SMTP_HOST) && !config.isTest;
  }

  private getTransporter() {
    this.transporter ??= nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
    return this.transporter;
  }

  async send(messages: OutboundMessage[]) {
    const t = this.getTransporter();
    await Promise.allSettled(
      messages.map((m) =>
        t
          .sendMail({
            from: config.EMAIL_FROM,
            to: `"${m.to.name.replace(/"/g, '')}" <${m.to.email}>`,
            subject: m.subject,
            text: m.link ? `${m.text}\n\nView ticket: ${m.link}` : m.text,
          })
          .catch((err) => logger.warn({ err, to: m.to.email }, 'Email delivery failed')),
      ),
    );
  }
}

export const channels: NotificationChannel[] = [new SmtpEmailChannel()];
