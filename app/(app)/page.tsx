import { getOrgs } from "@/lib/org-server";
import DashboardClient from "./DashboardClient";

/**
 * Server wrapper: resolve as orgs reais do usuário e rende o cliente.
 * FASE 2B: o dashboard passou a precisar da org ativa para consultar
 * GET /api/v1/tools com orgId (exigência da C1, Fase 2A) — mesmo padrão
 * das páginas de jobs/catálogo (wrapper server + cliente com useOrg).
 */
export default async function DashboardPage() {
  const orgs = await getOrgs();
  return <DashboardClient orgs={orgs} />;
}
