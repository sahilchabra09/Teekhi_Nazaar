import { headers } from "next/headers";
import { redirect } from "next/navigation";

import Console from "@/components/console/console";
import { authClient } from "@/lib/auth-client";

export default async function ConsolePage() {
  const session = await authClient
    .getSession({ fetchOptions: { headers: await headers() } })
    .then((r) => r.data)
    .catch(() => null);

  if (!session?.user) redirect("/login");

  return <Console userName={session.user.name || session.user.email} />;
}
