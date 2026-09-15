import { UnrecoverableError, type Job } from "bullmq";
import { sendRawEmail } from "./email.mailer";
import { decryptEmail } from "./email.crypto";
import type { EmailDispatchJob } from "./email.types";
import { traceStorage } from "../../shared/logger";

export const processEmailJob = async (job: Job<EmailDispatchJob>) => {
  if (Date.parse(job.data.expiresAt) <= Date.now()) throw new UnrecoverableError("Email command expired");
  return traceStorage.run({ traceId: job.data.traceId }, async () => {
    try {
      return await sendRawEmail(decryptEmail(job.data.ciphertext));
    } catch (error) {
      const code = (error as { responseCode?: number }).responseCode;
      // Provider responses can contain recipient addresses; persist only safe classifications.
      if (code && code >= 500) throw new UnrecoverableError("SMTP rejected message (" + code + ")");
      throw new Error(code ? "SMTP temporarily unavailable (" + code + ")" : "Email transport unavailable");
    }
  });
};
