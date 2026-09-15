export {
  emailDispatchRequestSchema as sendEmailRequestSchema,
  type EmailDispatchRequest as SendEmailRequest,
  type EmailDispatchResponse as EmailDispatchResult,
  type EmailTemplateName as SystemTemplateName,
} from "@sebascarvajal11/cima-contracts";
export interface RenderedEmail { subject: string; text: string; html: string }
export interface EmailDispatchJob {
  ciphertext: string;
  fingerprint: string;
  expiresAt: string;
  traceId: string;
  producer: string;
}
