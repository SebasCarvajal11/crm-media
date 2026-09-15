import { describe, expect, it, vi } from "vitest";
import { renderSystemTemplate, escapeHtml } from "./email.templates";
import { sendEmailRequestSchema } from "./email.types";
import { createEmailService } from "./email.service";

describe("email.templates", () => {
  it("escapes html special characters", () => {
    expect(escapeHtml("<script>alert('xss')&\"</script>")).toBe(
      "&lt;script&gt;alert('xss')&amp;&quot;&lt;/script&gt;"
    );
  });

  it("renders password_reset template", () => {
    const rendered = renderSystemTemplate(
      "password_reset",
      { token: "abc-token-123" },
      "test@cima.dev",
      "https://crm.cima.dev"
    );

    expect(rendered.subject).toContain("Recuperación de contraseña");
    expect(rendered.text).toContain("https://crm.cima.dev/reset-password?token=abc-token-123");
    expect(rendered.html).toContain("test@cima.dev");
    expect(rendered.html).toContain("https://crm.cima.dev/reset-password?token=abc-token-123");
  });

  it("renders client_invite and worker_invite templates", () => {
    const client = renderSystemTemplate(
      "client_invite",
      { token: "client-token" },
      "cliente@empresa.com",
      "https://crm.cima.dev"
    );
    expect(client.subject).toContain("Invitación a CIMA CRM (cliente)");
    expect(client.text).toContain("/accept-invite/client-token");

    const worker = renderSystemTemplate(
      "worker_invite",
      { token: "worker-token", role: "diseñador" },
      "worker@cima.dev",
      "https://crm.cima.dev"
    );
    expect(worker.subject).toContain("diseñador");
    expect(worker.text).toContain("/accept-invite/worker-token");
  });

  it("renders email_verify template", () => {
    const verify = renderSystemTemplate(
      "email_verify",
      { token: "verify-token" },
      "nuevo@cima.dev",
      "https://crm.cima.dev"
    );
    expect(verify.subject).toContain("Verifica tu correo");
    expect(verify.text).toContain("/verify-email?token=verify-token");
  });
});

describe("email.types validation", () => {
  it("validates direct content payload", () => {
    const valid = sendEmailRequestSchema.safeParse({
      to: "usuario@ejemplo.com",
      content: {
        subject: "Aviso importante",
        html: "<p>Hola mundo</p>",
      },
    });
    expect(valid.success).toBe(true);
  });

  it("validates template payload", () => {
    const valid = sendEmailRequestSchema.safeParse({
      to: "usuario@ejemplo.com",
      template: {
        name: "password_reset",
        variables: { token: "token-123" },
      },
    });
    expect(valid.success).toBe(true);
  });

  it("fails when neither content nor template is provided", () => {
    const invalid = sendEmailRequestSchema.safeParse({
      to: "usuario@ejemplo.com",
    });
    expect(invalid.success).toBe(false);
  });
});

describe("email.service dispatch", () => {
  it("dispatches synchronous email in log mode", async () => {
    const service = createEmailService();
    const result = await service.dispatchEmail({
      to: "destinatario@cima.dev",
      content: {
        subject: "Prueba directa",
        html: "<b>Hola</b>",
      },
      sync: true,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("sent");
    expect(result.messageId).toBeTruthy();
  });
});