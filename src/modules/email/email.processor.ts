import type { Job } from "bullmq";
import { sendRawEmail } from "./email.mailer";
import type { EmailDispatchJob } from "./email.types";
import { traceStorage, getLogger } from "../../shared/logger";

const logger = getLogger();

export const processEmailJob = async (job: Job<EmailDispatchJob>): Promise<void> => {
  const { traceId, ...emailData } = job.data;
  const dispatchAction = async () => {
    logger.info({ topic: "worker:email", jobId: job.id, to: emailData.to }, "Processing email job");
    await sendRawEmail(emailData);
  };

  if (traceId) {
    await traceStorage.run({ traceId }, dispatchAction);
  } else {
    await dispatchAction();
  }
};