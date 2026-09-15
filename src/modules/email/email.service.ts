import { createHash } from "node:crypto";
import { env } from "../../config/env";
import { AppError, BadRequestError, ConflictError } from "../../shared/middlewares/error-handler.middleware";
import { getEmailQueue } from "./email.queue";
import { renderSystemTemplate } from "./email.templates";
import { encryptEmail } from "./email.crypto";
import type { EmailDispatchResult, SendEmailRequest } from "./email.types";

export const createEmailService = (queueProvider = getEmailQueue) => ({
  dispatchEmail: async (req: SendEmailRequest, producer: string, traceId: string): Promise<EmailDispatchResult> => {
    const remaining = Date.parse(req.expiresAt) - Date.now();
    if (remaining <= 0 || remaining > 7 * 86400_000) {
      throw new BadRequestError("expiresAt debe estar dentro de los próximos 7 días");
    }
    const queue = queueProvider();
    if (!queue) throw new AppError(503, "Cola de correo no disponible", "DEPENDENCY_FAILED");
    const fingerprint = createHash("sha256").update(JSON.stringify(req)).digest("hex");
    const jobId = "email-" + createHash("sha256").update(producer).digest("hex").slice(0, 16) + "-" + req.id;
    const content = req.template
      ? renderSystemTemplate(req.template.name, req.template.variables, req.to, env.APP_PUBLIC_URL)
      : req.content!;
    const ciphertext = encryptEmail({ to: req.to, replyTo: req.replyTo, ...content });
    try {
      await queue.add("send", { ciphertext, fingerprint, expiresAt: req.expiresAt, producer, traceId }, { jobId });
      // Read the winning record after atomic add, including concurrent duplicate requests.
      const accepted = await queue.getJob(jobId);
      if (!accepted) throw new Error("Queue receipt missing");
      if (accepted.data.fingerprint !== fingerprint) throw new ConflictError("El identificador ya pertenece a otro correo");
    } catch (error) {
      if (error instanceof ConflictError) throw error;
      throw new AppError(503, "No se pudo confirmar la recepción del correo", "DEPENDENCY_FAILED");
    }
    return { success: true, messageId: jobId, status: "queued" };
  },
});
export const emailService = createEmailService();
