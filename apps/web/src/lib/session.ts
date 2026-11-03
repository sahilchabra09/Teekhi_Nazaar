import { headers } from "next/headers";

import { authClient, type Role } from "./auth-client";

export type SessionUser = { id: string; name: string; email: string; image?: string | null; role: Role | null };

/** Server-side session lookup (null when signed out or the API is unreachable). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await authClient
    .getSession({ fetchOptions: { headers: await headers() } })
    .then((r) => r.data)
    .catch(() => null);
  if (!session?.user) return null;
  const role = session.user.role === "doctor" || session.user.role === "patient" ? session.user.role : null;
  return { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image, role };
}
