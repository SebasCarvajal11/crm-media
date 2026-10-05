import { Queue } from "bullmq";
import { getRedisConnection } from "../../shared/redis";
import { env } from "../../config/env";
import type { EmailDispatchJob } from "./email.types";

export const EMAIL_QUEUE_NAME = "crm-media-email";

export const DEFAULT_EMAIL_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 3000 },
  removeOnComplete: {
    age: 24 * 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 86400,
    count: 5000,
  },
} as const;

let emailQueue: Queue<EmailDispatchJob> | undefined;

export const getEmailQueue = (): Queue<EmailDispatchJob> | undefined => {
  const conn = getRedisConnection();
  if (!conn) return undefined;
  if (!emailQueue) {
    emailQueue = new Queue<EmailDispatchJob>(EMAIL_QUEUE_NAME, {
      connection: conn as any,
      prefix: env.EMAIL_QUEUE_PREFIX,
      defaultJobOptions: DEFAULT_EMAIL_JOB_OPTIONS,
    });
  }
  return emailQueue;
};
