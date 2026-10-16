import type { Org } from "./workflow-models";

/**
 * Server-side org resolution for the workflows UI.
 * Reads the user's real memberships (memberships + organizations tables).
 * Never invents: returns [] when there is no session or no membership.
 */
export async function getOrgs(): Promise<Org[]> {
  try {
    const mod = await import("@/lib/auth");
    if (typeof mod.getUserOrganizations !== "function") return [];
    const memberships = await mod.getUserOrganizations();
    return memberships.map((m) => ({
      id: m.orgId,
      name: m.orgName ?? m.orgId,
      role: m.role,
    }));
  } catch {
    return [];
  }
}
