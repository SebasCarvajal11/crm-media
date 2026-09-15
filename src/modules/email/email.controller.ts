import type { Context } from "hono";
import { sendEmailRequestSchema, type SendEmailRequest } from "./email.types";
import { emailService } from "./email.service";
import { getLogger } from "../../shared/logger";

const logger = getLogger();

export const emailController = {
  sendEmail: async (c: Context) => {
    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Cuerpo JSON inválido o ausente" }, 400);
    }

    const parsed = sendEmailRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      return c.json(
        {
          error: "Parámetros de correo inválidos",
          details: parsed.error.flatten().fieldErrors,
        },
        400
      );
    }

    const traceId = c.req.header("x-trace-id") || c.req.header("x-correlation-id");
    try {
      const result = await emailService.dispatchEmail(parsed.data, traceId);
      const statusCode = result.status === "sent" ? 200 : 202;
      return c.json(result, statusCode);
    } catch (err: any) {
      logger.error({ err, topic: "email:controller" }, "Error al procesar correo");
      return c.json({ error: "Error al despachar el correo", message: err.message }, 500);
    }
  },

  sendTemplateShortcut: async (c: Context) => {
    let rawBody: any;
    try {
      rawBody = await c.req.json();
    } catch {
      return c.json({ error: "Cuerpo JSON inválido o ausente" }, 400);
    }

    const request: SendEmailRequest = {
      to: rawBody.to,
      subject: rawBody.subject,
      template: {
        name: rawBody.template || rawBody.name,
        variables: rawBody.variables || {},
      },
      sync: Boolean(rawBody.sync),
    };

    const parsed = sendEmailRequestSchema.safeParse(request);
    if (!parsed.success) {
      return c.json(
        {
          error: "Parámetros de plantilla inválidos",
          details: parsed.error.flatten().fieldErrors,
        },
        400
      );
    }

    const traceId = c.req.header("x-trace-id") || c.req.header("x-correlation-id");
    try {
      const result = await emailService.dispatchEmail(parsed.data, traceId);
      const statusCode = result.status === "sent" ? 200 : 202;
      return c.json(result, statusCode);
    } catch (err: any) {
      logger.error({ err, topic: "email:controller" }, "Error al procesar plantilla");
      return c.json({ error: "Error al despachar la plantilla", message: err.message }, 500);
    }
  },
};