import { Hono } from "hono";
import { emailController } from "./email.controller";

export const emailRoutes = new Hono();

emailRoutes.post("/send", emailController.sendEmail);
emailRoutes.post("/send-template", emailController.sendTemplateShortcut);