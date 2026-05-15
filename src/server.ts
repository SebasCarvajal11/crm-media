import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { env } from "./config/env";

serve({
  fetch: createApp().fetch,
  port: env.PORT,
});

console.log(`mod-media listening on :${env.PORT}`);