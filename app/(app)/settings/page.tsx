import { getOrgs } from "@/lib/org-server";
import SettingsClient from "./SettingsClient";

/** Server wrapper: real orgs + session email, then renders the client. */
export default async function SettingsPage() {
  const orgs = await getOrgs();
  let email: string | null = null;
  try {
    const mod = await import("@/lib/auth");
    const session = await mod.getSession();
    email = session?.user?.email ?? null;
  } catch {
    email = null;
  }
  return <SettingsClient orgs={orgs} email={email} />;
}
