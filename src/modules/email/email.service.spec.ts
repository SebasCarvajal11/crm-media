import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("../../config/env", () => ({ env: {
  APP_PUBLIC_URL: "https://crm.example.test",
  EMAIL_QUEUE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
} }));
import { renderSystemTemplate, escapeHtml } from "./email.templates";
import { sendEmailRequestSchema, type SendEmailRequest } from "./email.types";
import { createEmailService } from "./email.service";
import { decryptEmail } from "./email.crypto";

const request = (): SendEmailRequest => ({
  version: 1, id: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
  to: "test@hurl.test", template: { name: "password_reset", variables: { token: "opaque-token" } },
});
function fixture() {
  const records = new Map<string, { data: unknown }>();
  const queue = {
    add: vi.fn(async (_name: string, data: unknown, opts: { jobId: string }) => {
      if (!records.has(opts.jobId)) records.set(opts.jobId, { data });
    }),
    getJob: vi.fn(async (id: string) => records.get(id)),
  };
  return { queue, records, service: createEmailService(() => queue as never) };
}
describe("central email service", () => {
  it.each([
    ["client_invite", "cliente", "/accept-invite/"],
    ["worker_invite", "colaborador", "/accept-invite/"],
    ["admin_invite", "administrador", "/accept-invite/"],
    ["password_reset", "contraseña", "/reset-password?token="],
    ["email_verify", "correo", "/verify-email?token="],
  ] as const)("renders %s with the correct role and route", (name, label, route) => {
    const email = renderSystemTemplate(name, { token: "a/b?c" }, "test@hurl.test", "https://crm.example.test");
    expect(email.subject).toContain(label);
    expect(email.text).toContain(route + "a%2Fb%3Fc");
  });
  it("escapes user-controlled text", () => expect(escapeHtml('<>&"')).toBe("&lt;&gt;&amp;&quot;"));
  it("validates the shared schema and rejects conflicting content or sender overrides", () => {
    expect(sendEmailRequestSchema.safeParse(request()).success).toBe(true);
    expect(sendEmailRequestSchema.safeParse({ ...request(), content: { subject: "x", html: "x", text: "x" } }).success).toBe(false);
    expect(sendEmailRequestSchema.safeParse({ ...request(), from: "attacker@test.com" }).success).toBe(false);
    expect(sendEmailRequestSchema.safeParse({ ...request(), sync: true }).success).toBe(false);
    expect(sendEmailRequestSchema.safeParse({ ...request(), to: ["a@test.com", "b@test.com"] }).success).toBe(false);
  });
  it("encrypts queue data and deduplicates concurrent retries", async () => {
    const { service, records } = fixture();
    const req = request();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.dispatchEmail(req, "crm-auth", req.id)));
    expect(new Set(results.map(x => x.messageId)).size).toBe(1);
    expect(records.size).toBe(1);
    const data = [...records.values()][0].data as { ciphertext: string };
    expect(JSON.stringify(data)).not.toContain("opaque-token");
    expect(decryptEmail(data.ciphertext).text).toContain("opaque-token");
  });
  it("rejects reusing an identifier with a different payload", async () => {
    const { service } = fixture(); const req = request();
    await service.dispatchEmail(req, "crm-auth", req.id);
    await expect(service.dispatchEmail({ ...req, to: "other@hurl.test" }, "crm-auth", req.id)).rejects.toMatchObject({ statusCode: 409 });
  });
  it("keeps separate producer namespaces", async () => {
    const { service, records } = fixture(); const req = request();
    await service.dispatchEmail(req, "crm-auth", req.id);
    await service.dispatchEmail(req, "crm-marketing", req.id);
    expect(records.size).toBe(2);
  });
  it("fails visibly when Redis is unavailable", async () => {
    await expect(createEmailService(() => undefined).dispatchEmail(request(), "crm-auth", "trace")).rejects.toMatchObject({ statusCode: 503 });
    const { service, queue } = fixture(); queue.add.mockRejectedValueOnce(new Error("Redis down"));
    await expect(service.dispatchEmail(request(), "crm-auth", "trace")).rejects.toMatchObject({ statusCode: 503 });
  });
  it.each([-1000, 8 * 86400000])("rejects expired or excessive lifetimes", async (offset) => {
    await expect(fixture().service.dispatchEmail({ ...request(), expiresAt: new Date(Date.now() + offset).toISOString() }, "crm-auth", "trace")).rejects.toMatchObject({ statusCode: 400 });
  });
});
