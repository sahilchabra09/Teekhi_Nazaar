import { careRelation, type UserRole } from "@Teekhi_Nazaar/db/schema/care";
import { and, eq } from "drizzle-orm";
import { createMiddleware } from "hono/factory";

import { db, auth } from "./services";

/**
 * Role-based access control (docs/care.md §2).
 * Roles live on the user row ("patient" | "doctor", null until chosen) and come back on the
 * Better Auth session, so no extra query per request.
 */

export type SessionUser = { id: string; name: string; email: string; role: UserRole | null };
export type AuthedEnv = { Variables: { user: SessionUser } };

export const requireSession = createMiddleware<AuthedEnv>(async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return c.json({ error: "UNAUTHORIZED", message: "Sign in first." }, 401);
  const u = session.user as typeof session.user & { role?: string | null };
  c.set("user", {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role === "doctor" || u.role === "patient" ? u.role : null,
  });
  await next();
});

export const requireRole = (role: UserRole) =>
  createMiddleware<AuthedEnv>(async (c, next) => {
    const user = c.get("user");
    if (!user.role) return c.json({ error: "ROLE_REQUIRED", message: "Choose whether you're a patient or a doctor first." }, 403);
    if (user.role !== role) return c.json({ error: "FORBIDDEN", message: `This is only available to ${role}s.` }, 403);
    await next();
  });

/** True if this doctor is assigned to this patient. */
export async function treats(doctorId: string, patientId: string) {
  const [row] = await db
    .select({ id: careRelation.id })
    .from(careRelation)
    .where(and(eq(careRelation.doctorId, doctorId), eq(careRelation.patientId, patientId)))
    .limit(1);
  return Boolean(row);
}
