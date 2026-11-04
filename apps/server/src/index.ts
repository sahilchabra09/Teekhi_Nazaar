import { Hono } from "hono";
import { cors } from "hono/cors";

import { ENV } from "./env.server";
import { createRobotGateway } from "./mobile/gateway";
import { doctorRoutes } from "./routes/doctor";
import { meRoutes } from "./routes/me";
import { auth } from "./services";
import { talkRoutes } from "./talk/routes";

/** Phone pairing, media relay (/ws), auth and /api/mobile/* (docs/mobile.md). */
const gateway = createRobotGateway({
  speech: ENV.DEEPGRAM_API_KEY ? { apiKey: ENV.DEEPGRAM_API_KEY, sttModel: ENV.DEEPGRAM_STT_MODEL, ttsModel: ENV.DEEPGRAM_TTS_MODEL } : undefined,
  origin: ENV.CORS_ORIGIN,
  robotOwnerId: ENV.IRIS_ROBOT_OWNER_ID,
  authBaseUrl: ENV.BETTER_AUTH_URL,
  googleEnabled: !!ENV.GOOGLE_CLIENT_ID && !!ENV.GOOGLE_CLIENT_SECRET,
  talkHandler: async (request) => api.fetch(request),
  authHandler: (request) => auth.handler(request),
  resolve: (headers) => auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } }),
});

/** Care + conversation API (docs/care.md, docs/talk.md). Its own CORS: doctors also PATCH/DELETE. */
const api = new Hono();
api.use(
  "/*",
  cors({
    origin: ENV.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  }),
);
api.route("/api/me", meRoutes);
api.route("/api/doctor", doctorRoutes);
api.route("/api/talk", talkRoutes);

const API_PREFIXES = ["/api/me", "/api/doctor", "/api/talk"];
const isApiPath = (pathname: string) => API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

// Do not log request URLs: WebSocket URLs contain short-lived, single-use tickets.
export default {
  ...gateway,
  // Reports (≤ 25 MB) and audio clips (≤ 5 MB) need more than the gateway's 512 KB default.
  // /api/mobile/* keeps its own 4 KB body limit inside the gateway.
  maxRequestBodySize: 30 * 1024 * 1024,
  fetch(request: Request, server: Parameters<typeof gateway.fetch>[1]) {
    if (isApiPath(new URL(request.url).pathname)) return api.fetch(request, { server });
    return gateway.fetch(request, server);
  },
  hostname: "0.0.0.0",
  port: Number(process.env.PORT ?? 3000),
};
