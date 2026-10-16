import { getOrgs } from "@/lib/org-server";
import ApprovalsClient from "./ApprovalsClient";

/** Server wrapper: resolves the user's real orgs, then renders the client. */
export default async function ApprovalsPage() {
  const orgs = await getOrgs();
  return <ApprovalsClient orgs={orgs} />;
}
