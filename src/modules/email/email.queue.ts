import { Queue } from "bullmq";
import { getRedisConnection } from "../../shared/redis";
import type { EmailDispatchJob } from "./email.types";

export const EMAIL_QUEUE_NAME = "mod-media-email";

let emailQueue: Queue<EmailDispatchJob> | undefined;

export const getEmailQueue = (): Queue<EmailDispatchJob> | undefined => {
  const conn = getRedisConnection();
  if (!conn) return undefined;
  if (!emailQueue) {
    emailQueue = new Queue<EmailDispatchJob>(EMAIL_QUEUE_NAME, {
      connection: conn as any,
      prefix: "media",
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 3000 },
        removeOnComplete: { count: 2500 },
        removeOnFail: { count: 5000 },
      },
    });
  }
  return emailQueue;
};