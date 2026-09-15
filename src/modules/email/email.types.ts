import { z } from "zod";

export const systemTemplateNameSchema = z.enum([
  "password_reset",
  "client_invite",
  "worker_invite",
  "email_verify",
]);

export type SystemTemplateName = z.infer<typeof systemTemplateNameSchema>;

export const emailRecipientSchema = z.union([
  z.string().email(),
  z.array(z.string().email()).min(1),
]);

export const systemTemplatePayloadSchema = z.object({
  name: systemTemplateNameSchema,
  variables: z.object({
    token: z.string().min(1),
    to: z.string().email().optional(),
    role: z.string().optional(),
    appPublicUrl: z.string().url().optional(),
  }).passthrough(),
});

export type SystemTemplatePayload = z.infer<typeof systemTemplatePayloadSchema>;

export const directContentPayloadSchema = z.object({
  subject: z.string().min(1).max(250),
  html: z.string().min(1),
  text: z.string().optional(),
});

export type DirectContentPayload = z.infer<typeof directContentPayloadSchema>;

export const sendEmailRequestSchema = z.object({
  to: emailRecipientSchema,
  from: z.string().optional(),
  replyTo: z.string().email().optional(),
  cc: emailRecipientSchema.optional(),
  bcc: emailRecipientSchema.optional(),
  subject: z.string().max(250).optional(),
  template: systemTemplatePayloadSchema.optional(),
  content: directContentPayloadSchema.optional(),
  sync: z.boolean().default(false),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (data) => Boolean(data.template || data.content),
  { message: "Debe especificar 'template' o 'content'", path: ["content"] }
);

export type SendEmailRequest = z.infer<typeof sendEmailRequestSchema>;

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export interface EmailDispatchJob {
  id: string;
  to: string | string[];
  from?: string;
  replyTo?: string;
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text: string;
  html: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export interface EmailDispatchResult {
  success: boolean;
  messageId: string;
  status: "sent" | "queued";
}