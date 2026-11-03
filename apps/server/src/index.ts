import { ENV } from "./env.server";
import { auth } from "./services";
import { createRobotGateway } from "./mobile/gateway";

const gateway = createRobotGateway({
  origin: ENV.CORS_ORIGIN,
  authHandler: (request) => auth.handler(request),
  resolve: (headers) => auth.api.getSession({ headers, query: { disableCookieCache: true, disableRefresh: true } }),
});
// Do not log request URLs: WebSocket URLs contain short-lived, single-use tickets.
export default { ...gateway, hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000) };
