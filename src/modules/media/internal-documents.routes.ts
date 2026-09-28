import { Hono } from "hono";
import { mediaCommandSchema } from "@sebascarvajal11/cima-contracts/media-asset-events";
import { verifyMediaCommandSignature } from "../../workers/media-command-signature";
import { executeCommand } from "../../workers/media-command-processor";
import { AppError } from "../../shared/middlewares/error-handler.middleware";
import { getLogger } from "../../shared/logger";

const logger = getLogger();
export const internalDocumentsRoutes = new Hono();

internalDocumentsRoutes.post("/command", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new AppError(400, "Cuerpo de solicitud JSON inválido");
  }

  const parsed = mediaCommandSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn({ errors: parsed.error.flatten() }, "[internal-documents] Comando inválido");
    return c.json({ error: "Comando inválido", details: parsed.error.flatten().fieldErrors }, 400);
  }

  const command = parsed.data;
  try {
    await verifyMediaCommandSignature(command);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Firma de comando inválida";
    logger.warn({ err, commandType: command.type }, "[internal-documents] Error verificando firma");
    return c.json({ error: message }, 401);
  }

  try {
    const result = await executeCommand(command);
    return c.json(result, 200);
  } catch (err: unknown) {
    if (err instanceof AppError) {
      return c.json({
        type: "file.command-failed",
        correlationId: command.correlationId,
        objectKey: command.objectKey,
        statusCode: err.statusCode,
        message: err.message,
      }, err.statusCode as any);
    }
    const message = err instanceof Error ? err.message : "Error interno ejecutando comando";
    logger.error({ err, commandType: command.type }, "[internal-documents] Error ejecutando comando");
    return c.json({
      type: "file.command-failed",
      correlationId: command.correlationId,
      objectKey: command.objectKey,
      statusCode: 500,
      message,
    }, 500);
  }
});
