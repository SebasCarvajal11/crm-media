import type { RenderedEmail, SystemTemplateName } from "./email.types";

const brand = {
  appName: "CIMA CRM",
  primary: "#8F2B2E",
  primaryDark: "#5f1a1d",
  accent: "#0066ff",
  accentSoft: "#e7f0ff",
  ink: "#0f172a",
  mutedInk: "#475569",
  border: "#d9e2ec",
  bg: "#eef2f7",
  card: "#ffffff",
  softRose: "#fff2f4",
  softAmber: "#fff9eb",
};

export const escapeHtml = (val: string): string =>
  val.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const p = (txt: string) =>
  `<p style="margin:0 0 16px 0; color:${brand.ink}; font-size:16px; line-height:1.6;">${txt}</p>`;

const eyebrow = (txt: string) =>
  `<span style="display:inline-block; padding:7px 12px; border-radius:999px; background:rgba(255,255,255,.2); color:#fff; border:1px solid rgba(255,255,255,.35); font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase;">${escapeHtml(txt)}</span>`;

const metricPill = (label: string, val: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px 0;"><tr><td style="padding:8px 12px; border-radius:999px; border:1px solid ${brand.border}; background:${brand.accentSoft};"><span style="font-size:12px; color:${brand.mutedInk};">${escapeHtml(label)}:</span> <span style="font-size:12px; color:${brand.accent}; font-weight:700;">${escapeHtml(val)}</span></td></tr></table>`;

const actionButton = (href: string, label: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 8px 0;"><tr><td style="border-radius:12px; background:linear-gradient(120deg, ${brand.primary} 0%, ${brand.primaryDark} 100%);"><a href="${href}" style="display:inline-block; padding:13px 22px; color:#fff; text-decoration:none; font-size:15px; font-weight:700; letter-spacing:.01em;">${escapeHtml(label)} -&gt;</a></td></tr></table>`;

const safeLink = (href: string) =>
  `<div style="margin-top:14px; padding:12px 14px; border-radius:10px; border:1px solid ${brand.border}; background:#fbfdff; color:${brand.mutedInk}; font-size:13px; line-height:1.5;">Si el botón no funciona, copia este enlace:<br /><a href="${href}" style="color:${brand.accent}; text-decoration:underline; word-break:break-all;">${href}</a></div>`;

const infoCard = (title: string, body: string, tone: "warning" | "neutral" = "warning") => {
  const bg = tone === "warning" ? brand.softRose : brand.softAmber;
  const border = tone === "warning" ? brand.primary : "#d97706";
  return `<div style="margin:18px 0 0 0; padding:14px 16px; border-radius:12px; border:1px solid ${brand.border}; background:${bg};"><p style="margin:0 0 7px 0; color:${brand.ink}; font-size:14px; font-weight:700;">${escapeHtml(title)}</p><p style="margin:0; color:${brand.mutedInk}; font-size:14px; line-height:1.55; border-left:3px solid ${border}; padding-left:10px;">${body}</p></div>`;
};

export const renderEmailShell = (params: {
  preview: string;
  eyebrowText: string;
  title: string;
  intro: string;
  bodyHtml: string;
  outro?: string;
}): string => {
  const footer = params.outro
    ? p(params.outro)
    : p("Este correo fue generado automáticamente por CIMA CRM. Si no reconoces esta acción, ignora este mensaje.");

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(params.title)}</title>
  </head>
  <body style="margin:0; padding:26px 12px; background:${brand.bg}; font-family:Inter, Segoe UI, Helvetica Neue, Arial, sans-serif;">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0;">${escapeHtml(params.preview)}</div>
    <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width:640px; margin:0 auto;">
      <tr>
        <td style="padding:0; border-radius:18px; overflow:hidden;">
          <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="background:${brand.card}; border:1px solid ${brand.border}; border-radius:18px; box-shadow:0 10px 28px rgba(15, 23, 42, .10);">
            <tr>
              <td style="padding:26px 24px 24px 24px; background:radial-gradient(110% 140% at 0% 0%, #b23d42 0%, ${brand.primary} 42%, ${brand.primaryDark} 100%);">
                ${eyebrow(params.eyebrowText)}
                <h1 style="margin:14px 0 0 0; color:#fff; font-size:30px; line-height:1.18; font-weight:800;">${escapeHtml(params.title)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;">
                ${p(params.intro)}
                ${params.bodyHtml}
                <hr style="margin:24px 0; border:none; border-top:1px solid ${brand.border};" />
                ${footer}
                <p style="margin:8px 0 0 0; color:${brand.mutedInk}; font-size:12px;">${brand.appName}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
};

const renderPasswordReset = (to: string, link: string): RenderedEmail => ({
  subject: "Recuperación de contraseña - CIMA CRM",
  text: `Solicitud de recuperación de contraseña\n\nCorreo asociado: ${to}\nUsa este enlace para restablecer tu contraseña:\n${link}\n\nSi no solicitaste este cambio, ignora este mensaje.`,
  html: renderEmailShell({
    preview: "Recupera el acceso a tu cuenta en un paso.",
    eyebrowText: "Seguridad de cuenta",
    title: "Recupera tu acceso",
    intro: "Recibimos una solicitud para restablecer tu contraseña. Este enlace expira en 1 hora.",
    bodyHtml: `${metricPill("Cuenta", to)}${actionButton(link, "Restablecer contraseña")}${safeLink(link)}${infoCard(
      "¿No reconoces esta solicitud?",
      "Puedes ignorar este correo. Tu contraseña actual seguirá activa mientras no uses este enlace."
    )}`,
  }),
});

const renderInvite = (to: string, link: string, roleName = "usuario"): RenderedEmail => ({
  subject: `Invitación a CIMA CRM (${roleName})`,
  text: `Invitación a CIMA CRM\n\nCorreo invitado: ${to}\nCompleta tu registro desde este enlace:\n${link}\n\nEl enlace solo debe usarse por el titular de este correo.`,
  html: renderEmailShell({
    preview: "Activa tu cuenta y comienza en CIMA CRM.",
    eyebrowText: "Invitación de acceso",
    title: "Tu acceso te espera",
    intro: `Un administrador te invitó a CIMA CRM como ${escapeHtml(roleName)}. Completa tu activación para iniciar.`,
    bodyHtml: `${metricPill("Correo invitado", to)}${actionButton(link, "Completar registro")}${safeLink(link)}${infoCard(
      "Importante",
      "Este enlace crea una cuenta asociada únicamente a este correo institucional.",
      "neutral"
    )}`,
  }),
});

const renderVerifyEmail = (link: string): RenderedEmail => ({
  subject: "Verifica tu correo - CIMA CRM",
  text: `Verificación de correo\n\nConfirma tu dirección de correo con este enlace (válido por 48 horas):\n${link}\n\nSi no realizaste esta solicitud, ignora este mensaje.`,
  html: renderEmailShell({
    preview: "Confirma tu correo y termina la activación.",
    eyebrowText: "Verificación de identidad",
    title: "Confirma tu correo",
    intro: "Para completar la activación, confirma que esta dirección de correo te pertenece.",
    bodyHtml: `${actionButton(link, "Verificar correo")}${safeLink(link)}${infoCard(
      "Vigencia del enlace",
      "Este enlace expira en 48 horas. Si vence, solicita uno nuevo desde tu cuenta."
    )}`,
  }),
});

export const renderSystemTemplate = (
  name: SystemTemplateName,
  variables: { token: string },
  targetEmail: string,
  defaultPublicUrl: string
): RenderedEmail => {
  const baseUrl = defaultPublicUrl.replace(/\/$/, "");
  const email = targetEmail;
  const token = encodeURIComponent(variables.token || "");

  switch (name) {
    case "password_reset":
      return renderPasswordReset(email, `${baseUrl}/reset-password?token=${token}`);
    case "client_invite":
      return renderInvite(email, `${baseUrl}/accept-invite/${token}`, "cliente");
    case "worker_invite":
      return renderInvite(email, `${baseUrl}/accept-invite/${token}`, "colaborador");
    case "admin_invite":
      return renderInvite(email, `${baseUrl}/accept-invite/${token}`, "administrador");
    case "email_verify":
      return renderVerifyEmail(`${baseUrl}/verify-email?token=${token}`);
  }
};
