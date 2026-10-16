import { getOrgs } from "@/lib/org-server";
import JobDetailClient from "./JobDetailClient";

/** Server wrapper: route params are async in Next.js 16 — await, then render. */
export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ deduplicated?: string }>;
}) {
  const { id } = await params;
  const { deduplicated } = await searchParams;
  const orgs = await getOrgs();
  return <JobDetailClient id={id} orgs={orgs} deduplicated={deduplicated === "1"} />;
}
