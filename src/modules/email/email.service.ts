import { env } from "../../config/env";
import { getLogger } from "../../shared/logger";
import { sendRawEmail } from "./email.mailer";
import { getEmailQueue } from "./email.queue";
import { renderSystemTemplate } from "./email.templates";
import type {
  EmailDispatchResult,
  RenderedEmail,
  SendEmailRequest,
} from "./email.types";

const logger = getLogger();

const resolveEmailContent = (
  req: SendEmailRequest,
  primaryRecipient: string
): RenderedEmail => {
  if (req.template) {
    const rendered = renderSystemTemplate(
      req.template.name,
      req.template.variables,
      primaryRecipient,
      env.APP_PUBLIC_URL
    );
    return {
      subject: req.subject || rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };
  }

  if (req.content) {
    return {
      subject: req.content.subject,
      html: req.content.html,
      text:
        req.content.text ||
        req.content.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
    };
  }

  throw new Error("El correo debe contener 'template' o 'content'");
};

export const createEmailService = () => ({
  dispatchEmail: async (
    req: SendEmailRequest,
    traceId?: string
  ): Promise<EmailDispatchResult> => {
    const primary = Array.isArray(req.to) ? req.to[0] : req.to;
    const { subject, html, text } = resolveEmailContent(req, primary);

    const emailPayload = {
      to: req.to,
      from: req.from || env.MAIL_FROM,
      replyTo: req.replyTo,
      cc: req.cc,
      bcc: req.bcc,
      subject,
      text,
      html,
    };

    if (req.sync) {
      const sent = await sendRawEmail(emailPayload);
      return { success: true, messageId: sent.messageId, status: "sent" };
    }

    const queue = getEmailQueue();
    if (!queue) {
      logger.warn({ topic: "mail:service" }, "Queue no disponible, enviando síncrono");
      const sent = await sendRawEmail(emailPayload);
      return { success: true, messageId: sent.messageId, status: "sent" };
    }

    const jobId = `email-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    await queue.add(
      "send",
      { id: jobId, ...emailPayload, traceId, metadata: req.metadata },
      { jobId }
    );

    return { success: true, messageId: jobId, status: "queued" };
  },
});

export const emailService = createEmailService();