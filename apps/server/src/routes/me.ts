import { user } from "@Teekhi_Nazaar/db/schema/auth";
import { USER_ROLES } from "@Teekhi_Nazaar/db/schema/care";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { ensurePatientProfile } from "../autosage/provision";
import { type AuthedEnv, requireSession } from "../rbac";
import { db } from "../services";

export const meRoutes = new Hono<AuthedEnv>();

meRoutes.use("*", requireSession);

/** GET /api/me → the signed-in user with their role (null until chosen). */
meRoutes.get("/", (c) => c.json(c.get("user")));

/**
 * POST /api/me/role { role: "patient" | "doctor" }
 * A role can be chosen exactly once; changing it later would silently move medical access.
 */
meRoutes.post("/role", async (c) => {
  const body = z.object({ role: z.enum(USER_ROLES) }).safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "VALIDATION_ERROR", message: "Role must be patient or doctor." }, 400);

  const me = c.get("user");
  if (me.role) {
    if (me.role === body.data.role) return c.json({ role: me.role });
    return c.json({ error: "ROLE_ALREADY_SET", message: `You're already registered as a ${me.role}.` }, 409);
  }

  const updated = await db
    .update(user)
    .set({ role: body.data.role })
    .where(and(eq(user.id, me.id), isNull(user.role)))
    .returning({ role: user.role });
  if (updated.length === 0) return c.json({ error: "ROLE_ALREADY_SET", message: "Your role was already set." }, 409);

  // A patient's medical memory (AutoSage knowledge base) is created right away, in the background.
  if (body.data.role === "patient") void ensurePatientProfile({ id: me.id, name: me.name });

  return c.json({ role: body.data.role });
});
