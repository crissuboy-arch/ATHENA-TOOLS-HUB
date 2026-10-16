import { getOrgs } from "@/lib/org-server";
import ResultsClient from "./ResultsClient";

/** Server wrapper: resolves the user's real orgs, then renders the client. */
export default async function ResultsPage() {
  const orgs = await getOrgs();
  return <ResultsClient orgs={orgs} />;
}
