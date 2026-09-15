import type { Context } from "hono";
import { sendEmailRequestSchema } from "./email.types";
import { emailService } from "./email.service";
import { authorizeEmail } from "./email.authorization";
import { BadRequestError, ForbiddenError } from "../../shared/middlewares/error-handler.middleware";
import { env } from "../../config/env";

export const emailController = {
  sendEmail: async (c: Context) => {
    const body = await c.req.text();
    const producer = await authorizeEmail(c.req.header("authorization"), body);
    let input: unknown;
    try { input = JSON.parse(body); } catch { throw new BadRequestError("Cuerpo JSON inválido"); }
    const parsed = sendEmailRequestSchema.safeParse(input);
    if (!parsed.success) throw new BadRequestError("Parámetros de correo inválidos");
    if (parsed.data.template && producer !== env.EMAIL_AUTH_ISSUER) {
      throw new ForbiddenError("Las plantillas de identidad pertenecen a auth");
    }
    const result = await emailService.dispatchEmail(parsed.data, producer, c.get("traceId") || parsed.data.id);
    return c.json(result, 202);
  },
};
