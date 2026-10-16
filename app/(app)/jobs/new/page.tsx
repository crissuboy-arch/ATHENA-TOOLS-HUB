import { getOrgs } from "@/lib/org-server";
import NewJobClient from "./NewJobClient";

/** Server wrapper: resolves the user's real orgs, then renders the client. */
export default async function NewJobPage() {
  const orgs = await getOrgs();
  return <NewJobClient orgs={orgs} />;
}
