import nodemailer, { type Transporter } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { env } from "../../config/env";
import { withRetry } from "@sebascarvajal11/cima-contracts";
import { getLogger } from "../../shared/logger";

const logger = getLogger();

let smtpTransport: Transporter | undefined;
let smtpVerified = false;

const getSmtpTransport = (): Transporter => {
  if (!smtpTransport) {
    const opts: SMTPTransport.Options = {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: env.SMTP_REQUIRE_TLS,
      auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
      tls:
        env.SMTP_TLS_SERVERNAME || env.SMTP_HOST
          ? { servername: env.SMTP_TLS_SERVERNAME ?? env.SMTP_HOST }
          : undefined,
    };
    smtpTransport = nodemailer.createTransport(opts);
  }
  return smtpTransport;
};

const ensureSmtpReady = async (): Promise<Transporter> => {
  const transport = getSmtpTransport();
  if (!smtpVerified) {
    await transport.verify();
    smtpVerified = true;
  }
  return transport;
};

export interface RawEmailPayload {
  to: string | string[];
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text: string;
  html: string;
}

export const sendRawEmail = async (payload: RawEmailPayload): Promise<{ messageId: string }> => {
  const mailOptions = {
    from: payload.from || env.MAIL_FROM,
    to: payload.to,
    replyTo: payload.replyTo,
    cc: payload.cc,
    bcc: payload.bcc,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  };

  if (env.MAIL_TRANSPORT === "log") {
    const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    logger.info({ topic: "mail:log", subject: mailOptions.subject, to: mailOptions.to, id: logId }, "Email logged");
    logger.debug({ text: mailOptions.text }, "Email content");
    return { messageId: logId };
  }

  const transport = await ensureSmtpReady();
  let resultInfo: any;

  await withRetry(
    async () => {
      resultInfo = await transport.sendMail(mailOptions);
    },
    { maxAttempts: 3, delayMs: 250 }
  );

  return { messageId: resultInfo?.messageId || `smtp-${Date.now()}` };
};