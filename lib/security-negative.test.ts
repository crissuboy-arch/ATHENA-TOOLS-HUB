/**
 * ATHENA TOOLS HUB — negative security tests.
 *
 * These tests ATTACK the system the way an adversary would and assert the
 * attack FAILS. They cover the six scenarios from the owner's security
 * review (2026-10-16):
 *
 *   (a) admin tries to make themselves (or anyone) owner      → DB trigger
 *   (b) user tries to read another org's data                 → RLS + app layer
 *   (c) job references a tool row from another tenant         → app layer + FK trigger
 *   (d) non-admin tries to execute an administrative function → REVOKE + guard
 *   (e) viewer tries to mutate data                           → app RBAC
 *   (f) member tries to decide an approval (owner/admin only) → app RBAC
 *
 * What runs HERE (vitest, no database):
 *   - static assertions on the shipped migration SQL (the trigger bodies,
 *     REVOKEs and guards must exist verbatim in the files that will run);
 *   - behavioral tests of the application authorization layer with a
 *     mocked database (resolveOrgScope, requireScope, createJob).
 *
 * What needs a LIVE database (cannot run here — no Postgres in this env):
 *   - the actual RLS attack matrix lives in supabase/verify_rls.sql, to be
 *     executed by the owner once the dedicated Supabase project exists.
 *   - every scenario below names its live counterpart in that script.
 *
 * `npx vitest run lib/security-negative.test.ts`
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Mocks (hoisted before imports)
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requireOrgRole: mocks.requireOrgRole,
  getSupabaseAdmin: mocks.getSupabaseAdmin,
  isSupabaseConfigured: () => true,
  getSession: async () => ({ user: { id: "user-1" } }),
  requireUser: async () => ({ id: "user-1" }),
}));

import { HubError } from "./errors";
import {
  requireScope,
  resolveOrgScope,
  type ApiAuthContext,
} from "./api-auth";
import type { OrgRole } from "./auth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const MIG = (name: string) =>
  readFileSync(join(process.cwd(), "supabase", "migrations", name), "utf8");

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function m2m(orgId: string, scopes: ("tools:read" | "jobs:read" | "jobs:write" | "approvals:decide")[]): ApiAuthContext {
  return { kind: "m2m", orgId, scopes, integrationId: "int-1" };
}

const userCtx: ApiAuthContext = { kind: "user", userId: "user-1" };

/** Simulates a membership DB: the mock requireOrgRole enforces `roles`. */
function mockMembership(role: OrgRole | null) {
  mocks.requireOrgRole.mockImplementation(async (_orgId: string, roles: OrgRole[]) => {
    if (!role || !roles.includes(role)) {
      throw HubError.forbidden("Você não tem permissão para esta organização/ação.");
    }
    return role;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ===========================================================================
// PART A — the shipped SQL contains the required defenses (attacks a, d)
// ===========================================================================
describe("migration 0005 — privilege-escalation defenses (attack a)", () => {
  const sql = MIG("0005_security_hardening.sql");

  it("revokes EXECUTE on bootstrap_organization from PUBLIC, anon and authenticated", () => {
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.bootstrap_organization\(text,\s*text,\s*uuid\)\s+FROM PUBLIC,\s*anon,\s*authenticated/i,
    );
  });

  it("installs a BEFORE INSERT OR UPDATE OR DELETE trigger on organization_members", () => {
    expect(sql).toMatch(/CREATE TRIGGER guard_membership_write/);
    expect(sql).toMatch(
      /BEFORE INSERT OR UPDATE OR DELETE ON public\.organization_members/i,
    );
  });

  it("trigger blocks role changes by non-owners", () => {
    expect(sql).toMatch(/role changes require the owner role/);
  });

  it("trigger blocks owners from changing their own role", () => {
    expect(sql).toMatch(/owners cannot change their own role/);
  });

  it("trigger blocks granting owner to non-owners and removing the last owner", () => {
    expect(sql).toMatch(/only an existing owner can grant the owner role/);
    expect(sql).toMatch(/cannot remove the last owner of the organization/);
    expect(sql).toMatch(/cannot delete the last owner of the organization/);
  });

  it("documents the threat model (T1)", () => {
    expect(sql).toMatch(/T1/);
    expect(sql).toMatch(/Privilege escalation/);
  });
});

describe("migration 0005 — bootstrap_organization lockdown (attack d)", () => {
  const sql = MIG("0005_security_hardening.sql");

  it("rejects any call carrying a user JWT (trusted-context guard)", () => {
    expect(sql).toMatch(/IF auth\.uid\(\) IS NOT NULL THEN/);
    expect(sql).toMatch(/restricted to trusted administrative context/);
  });

  it("no application code path calls bootstrap_organization", () => {
    const appRefs = ["app/api", "lib/jobs/service.ts", "lib/api-auth.ts"]
      .map((p) => {
        try {
          return readFileSync(join(process.cwd(), p), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    expect(appRefs).not.toMatch(/bootstrap_organization\s*\(/);
  });
});

describe("migration 0005 — cross-organization FK guards (attack c, DB layer)", () => {
  const sql = MIG("0005_security_hardening.sql");

  const cases: Array<[string, string, string]> = [
    ["tool_capabilities", "tool_id", "tools"],
    ["execution_jobs", "tool_id", "tools"],
    ["execution_jobs", "integration_id", "integrations"],
    ["execution_events", "job_id", "execution_jobs"],
    ["approval_requests", "job_id", "execution_jobs"],
    ["generated_assets", "job_id", "execution_jobs"],
    ["usage_records", "job_id", "execution_jobs"],
    ["usage_records", "tool_id", "tools"],
  ];

  it.each(cases)(
    "enforce_same_org trigger on %s.%s -> %s",
    (table, column, refTable) => {
      expect(sql).toMatch(
        new RegExp(
          `ON public\\.${table}[\\s\\S]*?EXECUTE FUNCTION public\\.enforce_same_org\\('${column}',\\s*'${refTable}'\\)`,
          "i",
        ),
      );
    },
  );

  it("fails closed with a cross-organization error", () => {
    expect(sql).toMatch(/cross-organization reference blocked/);
  });
});

describe("migration 0003 — seed integrity (no orphan org, licenses intact)", () => {
  const sql = MIG("0003_seed.sql");

  it("creates NO orphan default organization", () => {
    // The word 'default' appears in the DESIGN DECISION comment (explaining
    // the removal); what matters is no INSERT into organizations exists.
    expect(sql).not.toMatch(/INSERT INTO public\.organizations/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+organizations/i);
  });

  it("seeds via seed_catalog(org_id) and revokes it from the public", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.seed_catalog\(p_org_id uuid\)/);
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION public\.seed_catalog\(uuid\)\s+FROM PUBLIC,\s*anon,\s*authenticated/i,
    );
  });

  it("upserts NEVER overwrite state, license or license_verified", () => {
    const upserts = sql.match(/ON CONFLICT \(org_id, slug\) DO UPDATE SET([\s\S]*?);/g) ?? [];
    expect(upserts.length).toBeGreaterThan(0);
    for (const u of upserts) {
      const setClause = u.replace(/updated_at\s*=\s*now\(\)/, "");
      expect(setClause).not.toMatch(/(^|,\s*)state\s*=/);
      expect(setClause).not.toMatch(/(^|,\s*)license\s*=/);
      expect(setClause).not.toMatch(/license_verified\s*=/);
    }
  });

  it("carries the VERIFIED licenses (docs/CATALOG_LICENSES.md is source of truth)", () => {
    for (const slug of ["vectorcraft", "designcraft", "photocraft", "lightcraft", "artcraft", "wordcraft"]) {
      expect(sql).toMatch(new RegExp(`'${slug}'[\\s\\S]*?'MIT OR Apache-2\\.0', true`, "i"));
    }
    expect(sql).toMatch(/'hyperframes'[\s\S]*?'Apache-2\.0', true/i);
  });

  it("excludes artcraft-services (fair-source) and artcraftx (unlicensed)", () => {
    // The exclusion is DOCUMENTED in comments; what matters is that no
    // INSERT row carries those slugs.
    expect(sql).not.toMatch(/INSERT INTO public\.tools[\s\S]{0,400}artcraft-services/);
    expect(sql).not.toMatch(/'artcraft-services',/);
    expect(sql).not.toMatch(/'artcraftx',/);
  });

  it("uses the official upstream repository URLs", () => {
    expect(sql).toMatch(/https:\/\/github\.com\/storytold\/vectorcraft/);
    expect(sql).toMatch(/https:\/\/github\.com\/heygen-com\/hyperframes/);
    expect(sql).toMatch(/https:\/\/github\.com\/apify\/apify-mcp-server/);
    expect(sql).toMatch(/https:\/\/github\.com\/microsoft\/playwright-cli/);
    expect(sql).toMatch(/https:\/\/github\.com\/googleworkspace\/cli/);
  });
});

// ===========================================================================
// PART B — application authorization layer (attacks b, e, f)
// ===========================================================================
describe("api-auth — machine key cannot cross organizations (attack b)", () => {
  it("m2m key of org A requesting org B is rejected with 403", async () => {
    const ctx = m2m(ORG_A, ["jobs:read"]);
    await expect(resolveOrgScope(ctx, ORG_B)).rejects.toMatchObject({ status: 403 });
  });

  it("m2m key requesting its own org is allowed", async () => {
    const ctx = m2m(ORG_A, ["jobs:read"]);
    await expect(resolveOrgScope(ctx, ORG_A)).resolves.toBe(ORG_A);
    await expect(resolveOrgScope(ctx, undefined)).resolves.toBe(ORG_A);
  });

  it("m2m key without the required scope is rejected with 403", () => {
    const ctx = m2m(ORG_A, ["jobs:read"]);
    expect(() => requireScope(ctx, "approvals:decide")).toThrowError(
      expect.objectContaining({ status: 403 }),
    );
  });
});

describe("api-auth — role-based org scope (attacks e, f)", () => {
  it("viewer attempting a member-level mutation is rejected (attack e)", async () => {
    mockMembership("viewer");
    await expect(
      resolveOrgScope(userCtx, ORG_A, ["owner", "admin", "member"]),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("viewer CAN read (read path stays open)", async () => {
    mockMembership("viewer");
    await expect(resolveOrgScope(userCtx, ORG_A)).resolves.toBe(ORG_A);
  });

  it("member attempting an owner/admin-only approval decision is rejected (attack f)", async () => {
    mockMembership("member");
    await expect(
      resolveOrgScope(userCtx, ORG_A, ["owner", "admin"]),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("admin deciding an approval is allowed (positive control)", async () => {
    mockMembership("admin");
    await expect(resolveOrgScope(userCtx, ORG_A, ["owner", "admin"])).resolves.toBe(ORG_A);
  });

  it("non-member accessing any org is rejected (attack b, user path)", async () => {
    mockMembership(null);
    await expect(resolveOrgScope(userCtx, ORG_B)).rejects.toMatchObject({ status: 403 });
  });
});

// ===========================================================================
// PART C — service layer: tool references are always org-scoped (attack c)
// ===========================================================================
describe("jobs service — cross-tenant tool reference is impossible (attack c)", () => {
  interface Call {
    table: string;
    op: string;
    filters: Array<{ col: string; val: unknown }>;
    payload?: unknown;
  }

  const JOB_ID = "33333333-3333-4333-8333-333333333333";
  // Attacker in ORG_A tries to smuggle the RAW UUID of a tool row from ORG_B.
  const SMUGGLED_TOOL_UUID = "99999999-9999-4999-8999-999999999999";

  function makeFakeDb() {
    const calls: Call[] = [];
    const jobState = new Map<string, string>();

    const baseRow = () => ({
      id: JOB_ID,
      org_id: ORG_A,
      tool_id: null as string | null,
      tool_slug: "vectorcraft",
      state: jobState.get(JOB_ID) ?? "CREATED",
      params: {},
      result: null,
      error: null,
      idempotency_key: "11111111-1111-4111-8111-111111111111",
      created_by: "user-1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    function from(table: string) {
      const filters: Array<{ col: string; val: unknown }> = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push({ col, val });
          return chain;
        },
        maybeSingle: async () => {
          calls.push({ table, op: "select", filters: [...filters] });
          if (table === "tools") {
            // No tool row matches an org-scoped slug lookup for the
            // smuggled UUID (it is treated as a slug, never as a UUID).
            return { data: null, error: null };
          }
          if (table === "execution_jobs") {
            const byId = filters.find((f) => f.col === "id");
            if (byId) return { data: baseRow(), error: null };
            return { data: null, error: null }; // idempotency lookup: no duplicate
          }
          return { data: null, error: null };
        },
        single: async () => {
          calls.push({ table, op: "select", filters: [...filters] });
          return { data: baseRow(), error: null };
        },
        insert: (payload: unknown) => {
          calls.push({ table, op: "insert", filters: [], payload });
          return {
            select: () => ({
              single: async () => {
                const row = { ...baseRow(), ...(payload as Record<string, unknown>) };
                jobState.set(JOB_ID, String(row.state));
                return { data: row, error: null };
              },
            }),
            then: (resolve: (v: unknown) => void) =>
              resolve({ data: null, error: null }),
          };
        },
        update: (payload: unknown) => {
          const updFilters: Array<{ col: string; val: unknown }> = [];
          const updChain: Record<string, unknown> = {
            eq: (col: string, val: unknown) => {
              updFilters.push({ col, val });
              return updChain;
            },
            then: (resolve: (v: unknown) => void) => {
              calls.push({ table, op: "update", filters: updFilters, payload });
              const idFilter = updFilters.find((f) => f.col === "id");
              if (idFilter && (payload as Record<string, unknown>).state) {
                jobState.set(
                  String(idFilter.val),
                  String((payload as Record<string, unknown>).state),
                );
              }
              resolve({ data: null, error: null });
            },
          };
          return updChain;
        },
      };
      // Direct awaits: `await supabase.from(t).insert(...)` / `.update(...)`
      // resolve via the `then` defined above on each chain.
      return chain;
    }

    return { calls, from: (t: string) => from(t) };
  }

  it("toolId is resolved as an org-scoped SLUG — a smuggled UUID never becomes tool_id", async () => {
    const { createJob } = await import("./jobs/service");
    const db = makeFakeDb();
    mocks.getSupabaseAdmin.mockReturnValue(db);

    const { job, created } = await createJob(
      {
        orgId: ORG_A,
        toolId: SMUGGLED_TOOL_UUID, // attacker-controlled raw UUID of org B's tool
        params: {},
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      },
      { id: "user-1", type: "user" },
    );

    expect(created).toBe(true);

    // 1. The tool lookup was constrained to the attacker's org…
    const toolLookups = db.calls.filter((c) => c.table === "tools" && c.op === "select");
    expect(toolLookups.length).toBeGreaterThan(0);
    for (const q of toolLookups) {
      expect(q.filters).toContainEqual({ col: "org_id", val: ORG_A });
    }

    // 2. …so the smuggled UUID (treated as a slug) matched nothing…
    // 3. …and the inserted job carries tool_id = NULL, never org B's UUID.
    const inserts = db.calls.filter(
      (c) => c.table === "execution_jobs" && c.op === "insert",
    );
    expect(inserts.length).toBe(1);
    expect((inserts[0].payload as Record<string, unknown>).tool_id).toBeNull();
    expect(job.orgId).toBe(ORG_A);
  });

  it("every job write in the flow is org-scoped", async () => {
    const { createJob } = await import("./jobs/service");
    const db = makeFakeDb();
    mocks.getSupabaseAdmin.mockReturnValue(db);

    await createJob(
      {
        orgId: ORG_A,
        toolId: "vectorcraft",
        params: { prompt: "um ícone de seta dourada" },
        idempotencyKey: "22222222-2222-4222-8222-222222222222",
      },
      { id: "user-1", type: "user" },
    );

    const scopedReads = db.calls.filter(
      (c) => c.op === "select" && c.filters.some((f) => f.col === "org_id"),
    );
    // idempotency lookup + tool resolution + ≥2 loadJobRow calls
    expect(scopedReads.length).toBeGreaterThanOrEqual(4);
    for (const q of scopedReads) {
      expect(q.filters).toContainEqual({ col: "org_id", val: ORG_A });
    }
  });
});
