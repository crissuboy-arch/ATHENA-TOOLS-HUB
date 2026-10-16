import { getOrgs } from "@/lib/org-server";
import JobsClient from "./JobsClient";

/** Server wrapper: resolves the user's real orgs, then renders the client. */
export default async function JobsPage() {
  const orgs = await getOrgs();
  return <JobsClient orgs={orgs} />;
}
