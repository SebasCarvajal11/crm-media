import { describe, expect, it } from "vitest";
import { renderSystemTemplate, escapeHtml } from "./email.templates";

describe("email.templates", () => {
  const targetEmail = "destinatario@cima.dev";
  const baseUrl = "https://crm.cima.dev";

  it.each([
    ["password_reset", "contraseña", "Seguridad y"],
    ["client_invite", "cliente", "Invitación de"],
    ["worker_invite", "colaborador", "Invitación de"],
    ["admin_invite", "administrador", "Invitación de"],
    ["email_verify", "correo", "Verificación de"],
  ] as const)("renders %s with expected subject and eyebrow", (templateName, subjectWord, eyebrowWord) => {
    const rendered = renderSystemTemplate(templateName, { token: "tok123" }, targetEmail, baseUrl);
    expect(rendered.subject.toLowerCase()).toContain(subjectWord);
    expect(rendered.html).toContain(eyebrowWord);
    expect(rendered.html).toContain("CIMAXIS");
    expect(rendered.html).toContain("#86070c");
    expect(rendered.html).toContain("Montserrat");
  });

  it("never includes any external image tags across all templates", () => {
    const templates = [
      "password_reset",
      "client_invite",
      "worker_invite",
      "admin_invite",
      "email_verify",
    ] as const;

    for (const name of templates) {
      const rendered = renderSystemTemplate(name, { token: "tok123" }, targetEmail, baseUrl);
      expect(rendered.html).not.toMatch(/<img\b[^>]*>/i);
      expect(rendered.html).not.toMatch(/background-image:\s*url\(/i);
    }
  });

  it("escapes malicious payload in escapeHtml", () => {
    expect(escapeHtml("<script>alert(1)</script>&\"")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;"
    );
  });
});
