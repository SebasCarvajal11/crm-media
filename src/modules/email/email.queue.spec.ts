import { describe, expect, it } from "vitest";
import { DEFAULT_EMAIL_JOB_OPTIONS } from "./email.queue";

describe("email.queue configuration", () => {
  it("enforces strict count eviction on completed jobs to prevent RAM bloat", () => {
    expect(DEFAULT_EMAIL_JOB_OPTIONS.removeOnComplete).toBeDefined();
    expect(DEFAULT_EMAIL_JOB_OPTIONS.removeOnComplete.count).toBe(1000);
    expect(DEFAULT_EMAIL_JOB_OPTIONS.removeOnComplete.age).toBe(24 * 3600);
  });

  it("enforces strict count eviction on failed jobs to prevent unbounded retention", () => {
    expect(DEFAULT_EMAIL_JOB_OPTIONS.removeOnFail).toBeDefined();
    expect(DEFAULT_EMAIL_JOB_OPTIONS.removeOnFail.count).toBe(5000);
    expect(DEFAULT_EMAIL_JOB_OPTIONS.removeOnFail.age).toBe(7 * 86400);
  });

  it("configures exponential backoff with a reasonable initial delay", () => {
    expect(DEFAULT_EMAIL_JOB_OPTIONS.attempts).toBe(5);
    expect(DEFAULT_EMAIL_JOB_OPTIONS.backoff.type).toBe("exponential");
    expect(DEFAULT_EMAIL_JOB_OPTIONS.backoff.delay).toBe(3000);
  });
});
