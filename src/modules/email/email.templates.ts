import type { RenderedEmail, SystemTemplateName } from "./email.types";

const brand = {
  appName: "CIMA CRM",
  brandName: "CIMAXIS",
  fontFamily: "'Montserrat', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  primary: "#86070c",
  primaryDark: "#680609",
  ink: "#282829",
  mutedInk: "#626267",
  subtleInk: "#98989c",
  border: "#dededf",
  bg: "#f7f7f7",
  card: "#ffffff",
  softRedBg: "#fdf2f2",
  softRedBorder: "#f3d9da",
} as const;

export const escapeHtml = (val: string): string =>
  val.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const p = (txt: string) =>
  `<p style="margin:0 0 16px 0; color:${brand.ink}; font-family:${brand.fontFamily}; font-size:15px; line-height:1.6;">${txt}</p>`;

const dataBadge = (label: string, val: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 16px 0; width:100%;">` +
  `<tr><td style="padding:10px 14px; background-color:${brand.bg}; border:1px solid ${brand.border}; border-radius:8px;">` +
  `<span style="font-family:${brand.fontFamily}; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:${brand.subtleInk};">${escapeHtml(label)}:</span> ` +
  `<span style="font-family:${brand.fontFamily}; font-size:13px; font-weight:700; color:${brand.ink}; margin-left:6px;">${escapeHtml(val)}</span>` +
  `</td></tr></table>`;

const actionButton = (href: string, label: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 14px 0;">` +
  `<tr><td align="center" style="border-radius:8px; background-color:${brand.primary};">` +
  `<a href="${href}" target="_blank" style="display:inline-block; padding:13px 26px; font-family:${brand.fontFamily}; font-size:14px; font-weight:700; color:#ffffff; text-decoration:none; letter-spacing:0.02em; border-radius:8px;">${escapeHtml(label)} &rarr;</a>` +
  `</td></tr></table>`;

const safeLink = (href: string) =>
  `<div style="margin-top:14px; padding:12px 14px; border-radius:8px; border:1px solid ${brand.border}; background-color:${brand.bg}; color:${brand.mutedInk}; font-family:${brand.fontFamily}; font-size:12px; line-height:1.5;">` +
  `Si el botón no funciona, copia este enlace en tu navegador:<br />` +
  `<a href="${href}" style="color:${brand.primary}; text-decoration:underline; word-break:break-all; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px;">${href}</a>` +
  `</div>`;

const infoCard = (title: string, body: string, tone: "warning" | "neutral" = "warning") => {
  const bg = tone === "warning" ? brand.softRedBg : brand.bg;
  const border = tone === "warning" ? brand.softRedBorder : brand.border;
  const accentBar = tone === "warning" ? brand.primary : brand.subtleInk;
  return `<div style="margin:18px 0 0 0; padding:14px 16px; border-radius:8px; border:1px solid ${border}; background-color:${bg}; border-left:4px solid ${accentBar};">` +
    `<p style="margin:0 0 5px 0; color:${brand.ink}; font-family:${brand.fontFamily}; font-size:13px; font-weight:700;">${escapeHtml(title)}</p>` +
    `<p style="margin:0; color:${brand.mutedInk}; font-family:${brand.fontFamily}; font-size:13px; line-height:1.5;">${escapeHtml(body)}</p>` +
    `</div>`;
};

const renderBrandHeader = (): string =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:22px;">` +
  `<tr>` +
  `<td style="vertical-align:middle; padding-right:12px;">` +
  `<table role="presentation" cellspacing="0" cellpadding="0">` +
  `<tr><td style="width:34px; height:34px; background-color:${brand.primary}; border-radius:8px; text-align:center; vertical-align:middle;">` +
  `<span style="font-family:${brand.fontFamily}; font-size:19px; font-weight:900; color:#ffffff; line-height:34px;">C</span>` +
  `</td></tr>` +
  `</table>` +
  `</td>` +
  `<td style="vertical-align:middle;">` +
  `<div style="font-family:${brand.fontFamily}; font-size:18px; font-weight:900; letter-spacing:0.04em; color:${brand.ink}; text-transform:uppercase; line-height:1.1;">` +
  `CIMA<span style="color:${brand.primary}; font-weight:900;">XIS</span>` +
  `</div>` +
  `<div style="font-family:${brand.fontFamily}; font-size:9px; font-weight:700; letter-spacing:0.12em; color:${brand.subtleInk}; text-transform:uppercase; margin-top:2px;">` +
  `Centro de Innovación` +
  `</div>` +
  `</td>` +
  `</tr>` +
  `</table>`;

export const renderEmailShell = (params: {
  preview: string;
  eyebrowHtml: string;
  titleHtml: string;
  intro: string;
  bodyHtml: string;
  outro?: string;
}): string => {
  const footerNote = params.outro
    ? escapeHtml(params.outro)
    : "Este correo fue generado automáticamente por CIMA CRM. Si no reconoces esta acción, ignora este mensaje.";

  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
    <title>CIMA CRM</title>
  </head>
  <body style="margin:0; padding:24px 12px; background-color:${brand.bg}; font-family:${brand.fontFamily};">
    <div style="display:none; max-height:0; overflow:hidden; opacity:0; mso-hide:all;">${escapeHtml(params.preview)}</div>
    <table role="presentation" cellspacing="0" cellpadding="0" width="100%" style="max-width:600px; margin:0 auto;">
      <tr>
        <td style="background-color:${brand.card}; border:1px solid ${brand.border}; border-top:4px solid ${brand.primary}; border-radius:14px; padding:28px 26px; box-shadow:0 4px 14px rgba(40,40,41,0.05);">
          ${renderBrandHeader()}
          <div style="border-bottom:1px solid ${brand.border}; padding-bottom:18px; margin-bottom:20px;">
            <p style="margin:0 0 6px 0; font-family:${brand.fontFamily}; font-size:12px; font-weight:600; letter-spacing:0.06em; text-transform:uppercase; color:${brand.mutedInk};">
              ${params.eyebrowHtml}
            </p>
            <h1 style="margin:0 0 8px 0; font-family:${brand.fontFamily}; font-size:24px; line-height:1.25; font-weight:500; color:${brand.mutedInk}; letter-spacing:-0.01em;">
              ${params.titleHtml}
            </h1>
            <p style="margin:0; font-family:${brand.fontFamily}; font-size:14px; line-height:1.6; color:${brand.mutedInk};">
              ${escapeHtml(params.intro)}
            </p>
          </div>
          ${params.bodyHtml}
          <hr style="margin:26px 0 18px 0; border:none; border-top:1px solid ${brand.border};" />
          <p style="margin:0 0 8px 0; color:${brand.mutedInk}; font-family:${brand.fontFamily}; font-size:12px; line-height:1.5;">${footerNote}</p>
          <p style="margin:0; color:${brand.subtleInk}; font-family:${brand.fontFamily}; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">${brand.brandName} • ${brand.appName}</p>
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
    preview: "Recupera el acceso a tu cuenta en CIMA CRM.",
    eyebrowHtml: `Seguridad y <span style="font-weight:900; color:${brand.primary};">Acceso</span>`,
    titleHtml: `Restablece tu <span style="font-weight:900; color:${brand.ink};">Contraseña</span>`,
    intro: "Recibimos una solicitud para restablecer tu contraseña. Este enlace expira en 1 hora.",
    bodyHtml: `${dataBadge("Cuenta", to)}${actionButton(link, "Restablecer contraseña")}${safeLink(link)}${infoCard(
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
    eyebrowHtml: `Invitación de <span style="font-weight:900; color:${brand.primary};">Equipo</span>`,
    titleHtml: `Bienvenido a <span style="font-weight:900; color:${brand.ink};">CIMA<span style="color:${brand.primary};">XIS</span></span>`,
    intro: `Has sido invitado a formar parte de CIMA CRM con perfil de ${roleName}. Completa tu activación para ingresar.`,
    bodyHtml: `${dataBadge("Rol asignado", roleName.toUpperCase())}${dataBadge("Correo invitado", to)}${actionButton(link, "Completar registro")}${safeLink(link)}${infoCard(
      "Acceso institucional",
      "Este enlace crea una credencial personal asociada exclusivamente a esta dirección de correo.",
      "neutral"
    )}`,
  }),
});

const renderVerifyEmail = (link: string): RenderedEmail => ({
  subject: "Verifica tu correo - CIMA CRM",
  text: `Verificación de correo\n\nConfirma tu dirección de correo con este enlace (válido por 48 horas):\n${link}\n\nSi no realizaste esta solicitud, ignora este mensaje.`,
  html: renderEmailShell({
    preview: "Confirma tu correo y completa tu activación.",
    eyebrowHtml: `Verificación de <span style="font-weight:900; color:${brand.primary};">Identidad</span>`,
    titleHtml: `Confirma tu <span style="font-weight:900; color:${brand.ink};">Correo</span>`,
    intro: "Para completar la activación de tu cuenta, valida que esta dirección de correo electrónico te pertenece.",
    bodyHtml: `${actionButton(link, "Verificar correo")}${safeLink(link)}${infoCard(
      "Vigencia del enlace",
      "Este enlace expira en 48 horas. Si vence, podrás solicitar uno nuevo desde el portal de inicio."
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

