import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

import { ENV } from "./env.server";
import { auth } from "./services";
import { doctorRoutes } from "./routes/doctor";
import { meRoutes } from "./routes/me";
import { talkRoutes } from "./talk/routes";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));

// RBAC + care (docs/care.md)
app.route("/api/me", meRoutes);
app.route("/api/doctor", doctorRoutes);

// Speech → text → reply suggestions, grounded in the patient's AutoSage KB (docs/talk.md, docs/care.md)
app.route("/api/talk", talkRoutes);

app.get("/", (c) => {
  return c.text("OK");
});

export default app;
