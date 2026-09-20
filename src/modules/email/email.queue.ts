import { Queue } from "bullmq";
import { getRedisConnection } from "../../shared/redis";
import { env } from "../../config/env";
import type { EmailDispatchJob } from "./email.types";

export const EMAIL_QUEUE_NAME = "crm-media-email";

let emailQueue: Queue<EmailDispatchJob> | undefined;

export const getEmailQueue = (): Queue<EmailDispatchJob> | undefined => {
  const conn = getRedisConnection();
  if (!conn) return undefined;
  if (!emailQueue) {
    emailQueue = new Queue<EmailDispatchJob>(EMAIL_QUEUE_NAME, {
      connection: conn as any,
      prefix: env.EMAIL_QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 3000 },
        // Retain longer than the maximum command lifetime, without count eviction.
        removeOnComplete: { age: 8 * 86400 },
        removeOnFail: { age: 8 * 86400 },
      },
    });
  }
  return emailQueue;
};
