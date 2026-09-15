import { createSign, generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
const testState = vi.hoisted(() => ({ pem: "", prefix: "email-integration-" + Date.now(), sent: [] as unknown[] }));
vi.mock("../../config/env", () => ({ env: {
  APP_PUBLIC_URL: "https://crm.example.test", EMAIL_AUTH_ISSUER: "crm-auth",
  EMAIL_SERVICE_JWKS: { "crm-auth": "https://auth.test/jwks", "crm-marketing": "https://marketing.test/jwks" },
  EMAIL_QUEUE_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
  get EMAIL_QUEUE_PREFIX() { return testState.prefix; },
} }));
vi.mock("@sebascarvajal11/cima-contracts/jwks", () => ({ JwksClient: class { getPublicKeyPem() { return testState.pem; } } }));
vi.mock("./email.mailer", () => ({ sendRawEmail: async (payload: unknown) => {
  testState.sent.push(payload); return { messageId: "smtp-test-" + testState.sent.length };
} }));
import { initRedis, closeRedisConnections } from "../../shared/redis";
import { onError } from "../../shared/middlewares/error-handler.middleware";
import { emailRoutes } from "./email.routes";
import { getEmailQueue, EMAIL_QUEUE_NAME } from "./email.queue";
import { processEmailJob } from "./email.processor";
import { emailBodyHash } from "./email.authorization";
import type { EmailDispatchJob } from "./email.types";

if (!process.env.EMAIL_TEST_REDIS_URL) throw new Error("EMAIL_TEST_REDIS_URL is required; use an isolated test Redis");
initRedis(process.env.EMAIL_TEST_REDIS_URL);
const queue = getEmailQueue()!;
const connection = new Redis(process.env.EMAIL_TEST_REDIS_URL, { maxRetriesPerRequest: null });
const worker = new Worker<EmailDispatchJob>(EMAIL_QUEUE_NAME, processEmailJob, { connection: connection as never, prefix: testState.prefix });
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
testState.pem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const app = new Hono().route("/api/v1/emails", emailRoutes).onError(onError);
function authorization(body: string, issuer = "crm-auth") {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ iss: issuer, sub: issuer, aud: "crm-media:email",
    purpose: "email:dispatch", iat: now, exp: now + 60, bodyHash: emailBodyHash(body) })).toString("base64url");
  const signer = createSign("RSA-SHA256"); signer.update(head + "." + payload);
  return "Bearer " + head + "." + payload + "." + signer.sign(pair.privateKey).toString("base64url");
}
const request = (template = true) => ({ version: 1, id: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString(),
  to: "integration@hurl.test", ...(template ? { template: { name: "client_invite", variables: { token: "one-time-token" } } }
    : { content: { subject: "Marketing", html: "<p>Hola</p>", text: "Hola" } }) });
const post = (payload: unknown, issuer = "crm-auth") => {
  const body = JSON.stringify(payload);
  return app.request("/api/v1/emails/send", { method: "POST", headers: { Authorization: authorization(body, issuer), "Content-Type": "application/json" }, body });
};
afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true }); // Unique, test-owned prefix only.
  await queue.close();
  await connection.quit();
  await closeRedisConnections();
});
describe("HTTP command + real Redis queue + worker", () => {
  it("accepts concurrent retries and delivers once with encrypted Redis storage", async () => {
    const payload = request();
    const responses = await Promise.all(Array.from({ length: 5 }, () => post(payload)));
    expect(responses.map(r => r.status)).toEqual([202,202,202,202,202]);
    const receipt = await responses[0].json();
    await vi.waitFor(async () => expect(await (await queue.getJob(receipt.messageId))!.getState()).toBe("completed"), { timeout: 5000 });
    expect(testState.sent).toHaveLength(1);
    const job = await queue.getJob(receipt.messageId);
    expect(JSON.stringify(job!.data)).not.toContain("one-time-token");
    expect((testState.sent[0] as { text: string }).text).toContain("/accept-invite/one-time-token");
    expect((await post(payload)).status).toBe(202);
    expect((await post({ ...payload, to: "changed@hurl.test" })).status).toBe(409);
  });
  it("blocks unauthenticated send and restricts identity templates to Auth", async () => {
    expect((await app.request("/api/v1/emails/send", { method: "POST", body: "{}" })).status).toBe(401);
    expect((await post(request(), "crm-marketing")).status).toBe(403);
    expect((await post(request(false), "crm-marketing")).status).toBe(202);
  });
  it("never sends an expired queued link", async () => {
    await expect(processEmailJob({ data: { expiresAt: new Date(0).toISOString() } } as never)).rejects.toThrow("expired");
  });
});
