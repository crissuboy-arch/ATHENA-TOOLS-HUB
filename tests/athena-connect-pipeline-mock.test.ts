/**
 * ATHENA CONNECT — teste obrigatório ponta a ponta COM MOCKS.
 *
 * Simula: ATHENA (chamador mock) → ferramenta "ScalaFlow" (MOCK — NÃO é
 * o repo canónico do ScalaFlow, cuja integração real NÃO está confirmada
 * neste repo: não existe adapter nem entrada de catálogo "scalaflow")
 * → consulta de estatísticas → resposta estruturada → resultado
 * apresentado à ATHENA.
 *
 * As três camadas são diferenciadas explicitamente:
 *   (a) CONEXÃO HTTP — POST /api/v1/athena/missions (rota real, jobs
 *       service mockado em memória) + envelope de missão;
 *   (b) AUTENTICAÇÃO — sem Bearer → 401; assinatura HMAC inválida →
 *       rejeitada; replay de nonce → 401 REPLAY_DETECTED (anti-replay
 *       REAL de lib/api-keys, em memória);
 *   (c) EXECUÇÃO FUNCIONAL — o executor MOCK valida params, devolve
 *       estatísticas ESTRUTURADAS (valores FIXTURE, nunca dados reais
 *       de clientes nem do ScalaFlow real) e o estado COMPLETED mapeia
 *       para SUCCEEDED no vocabulário Athena, apresentado via
 *       buildMissionResponse (real).
 * Casos negativos: tool inexistente → sem adapter (erro estruturado
 * NOT_FOUND na descoberta; missão exige aprovação por omissão segura);
 * chave m2m com approvals:decide NÃO decide (403, requireHumanSession).
 *
 * NENHUM executor real é ativado; NENHUM sistema externo é tocado.
 *
 * `npx vitest run tests/athena-connect-pipeline-mock.test.ts`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HubError } from "@/lib/errors";
import { checkReplayProtection, sha256Hex } from "@/lib/api-keys";
import {
  buildCanonicalString,
  signCanonicalString,
  verifyCanonicalSignature,
} from "@/lib/api-signing";
import { toolRegistry, type ToolContract } from "@/lib/adapters/types";
import { hubStatusToMissionStatus } from "@/lib/athena/adapter";
import {
  missionToJobInput,
  parseMission,
  resolveRequiresApproval,
} from "@/lib/athena/contract";
import { requireHumanSession } from "@/lib/api-auth";
import { buildMissionResponse } from "@/lib/athena/missions";
import type { JobDTO } from "@/lib/jobs/service";

const ORG_ID = "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a";
const MISSION_ID = "9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, headers: {} }),
  rateLimitIdentity: () => "test-identity",
}));

vi.mock("@/lib/api-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    authenticate: vi.fn(async (request: Request) => {
      const auth = request.headers.get("authorization") ?? "";
      if (!/^Bearer\s+.+/i.test(auth.trim())) {
        throw HubError.unauthorized(
          "Autenticação necessária: Bearer <api key> ou sessão válida.",
        );
      }
      return {
        kind: "m2m",
        orgId: ORG_ID,
        scopes: ["tools:read", "jobs:read", "jobs:write"],
        integrationId: "integration-athena",
      };
    }),
  };
});

// Store em memória para o jobs service mockado (idempotência real).
const store = new Map<string, Record<string, unknown>>();
let jobCounter = 0;

function makeJob(status: string): Record<string, unknown> {
  jobCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(jobCounter).padStart(12, "0")}`,
    orgId: ORG_ID,
    toolId: "scalaflow-mock",
    status,
    params: { query: "stats" },
    idempotencyKey: MISSION_ID,
    createdBy: "",
    createdAt: "2026-10-26T00:00:00.000Z",
    updatedAt: "2026-10-26T00:00:00.000Z",
    errorMessage: null,
    result: null,
    integrationStatus: "pending",
    startedAt: null,
  };
}

vi.mock("@/lib/jobs/service", () => ({
  integrationStatusFor: () => "pending",
  createJob: vi.fn(async (input: Record<string, unknown>) => {
    const key = `${input.orgId}:${input.idempotencyKey}`;
    const existing = store.get(key);
    if (existing) return { job: existing, created: false };
    const job = makeJob("QUEUED");
    store.set(key, job);
    return { job, created: true };
  }),
  getJob: vi.fn(async (id: string) => {
    for (const job of store.values()) if (job.id === id) return job;
    throw HubError.notFound("Job");
  }),
  getJobAssets: vi.fn(async () => []),
}));

import { POST as postMission } from "@/app/api/v1/athena/missions/route";

// ---------------------------------------------------------------------------
// MOCK da ferramenta "ScalaFlow" — contrato + executor SÓ de teste.
// Valores de stats são FIXTURE. Não é o ScalaFlow real, não lê BD real,
// não chama nenhum serviço externo.
// ---------------------------------------------------------------------------
interface MockStats {
  tool: string;
  mock: true;
  stats: { total_posts: number; posts_today: number; status: string };
}

const scalaflowMock: ToolContract & {
  execute: (params: unknown) => Promise<MockStats>;
} = {
  id: "scalaflow-mock",
  version: "0.1.0-mock",
  capabilities: ["stats.read"],
  executionReady: true, // SÓ no mock: o adapter real não existe.
  validateParams(params: unknown) {
    const p = params as Record<string, unknown>;
    if (p?.query === "stats") return { ok: true, errors: [] };
    return { ok: false, errors: ["query deve ser 'stats'"] };
  },
  dryRunInfo() {
    return { requiresApproval: false, estimatedCost: "mock: $0" };
  },
  async execute(params: unknown) {
    const validation = this.validateParams(params);
    if (!validation.ok) throw new Error(validation.errors.join("; "));
    return {
      tool: "scalaflow-mock",
      mock: true,
      stats: { total_posts: 42, posts_today: 3, status: "ok" },
    };
  },
};

beforeEach(() => {
  store.clear();
  jobCounter = 0;
  toolRegistry.register(scalaflowMock);
});

function missionRequest(body: Record<string, unknown>, bearer?: string) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  return new NextRequest("http://hub.test/api/v1/athena/missions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("(a) conexão HTTP — ATHENA → missão → job idempotente", () => {
  it("POST missão 201; reenvio do mesmo mission_id → 200 deduplicated", async () => {
    const body = {
      mission_id: MISSION_ID,
      tool_id: "scalaflow-mock",
      params: { query: "stats" },
      requires_human_approval: false,
    };
    const first = await postMission(missionRequest(body, "hub_live_test"));
    expect(first.status).toBe(201);
    const second = await postMission(missionRequest(body, "hub_live_test"));
    expect(second.status).toBe(200);
    const payload = (await second.json()) as unknown as { deduplicated: boolean; mission: { mission_id: string } };
    expect(payload.deduplicated).toBe(true);
    expect(payload.mission.mission_id).toBe(MISSION_ID);
  });

  it("sem Bearer → 401 (conexão recusada antes de qualquer execução)", async () => {
    const res = await postMission(
      missionRequest({
        mission_id: MISSION_ID,
        tool_id: "scalaflow-mock",
        params: { query: "stats" },
      }),
    );
    expect(res.status).toBe(401);
  });
});

describe("(b) autenticação — assinatura e anti-replay (implementação real)", () => {
  it("assinatura HMAC válida verifica; corpo adulterado → rejeitada", () => {
    const canonical = buildCanonicalString({
      method: "POST",
      pathAndQuery: "/api/v1/athena/missions",
      timestamp: "1761500000",
      nonce: "nonce-1",
      body: '{"query":"stats"}',
    });
    const secret = "hub_sign_test_secret";
    const signature = signCanonicalString(secret, canonical);
    expect(verifyCanonicalSignature(secret, canonical, signature)).toBe(true);
    const tampered = buildCanonicalString({
      method: "POST",
      pathAndQuery: "/api/v1/athena/missions",
      timestamp: "1761500000",
      nonce: "nonce-1",
      body: '{"query":"stats-adulterado"}',
    });
    expect(verifyCanonicalSignature(secret, tampered, signature)).toBe(false);
  });

  it("replay de nonce → 401 REPLAY_DETECTED (segunda chamada)", () => {
    const headers = new Headers({
      "x-request-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-nonce": "nonce-replay-teste-unico",
    });
    const fingerprint = sha256Hex("hub_live_test");
    checkReplayProtection(headers, fingerprint); // primeira: ok
    expect(() => checkReplayProtection(headers, fingerprint)).toThrowError(
      expect.objectContaining({ code: "REPLAY_DETECTED" }),
    );
  });

  it("chave m2m, mesmo com approvals:decide, NÃO decide aprovações", () => {
    expect(() =>
      requireHumanSession({
        kind: "m2m",
        orgId: ORG_ID,
        scopes: ["tools:read", "jobs:read", "jobs:write", "approvals:decide"],
        integrationId: "integration-athena",
      }),
    ).toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});

describe("(c) execução funcional — mock ScalaFlow → resposta à ATHENA", () => {
  it("missão válida → aprovação resolvida → mock executa → SUCCEEDED apresentado", async () => {
    // 1. A Athena monta a missão; o Hub valida contra o contrato MOCK.
    const mission = parseMission({
      mission_id: MISSION_ID,
      tool_id: "scalaflow-mock",
      params: { query: "stats" },
      requires_human_approval: false,
    });
    expect(resolveRequiresApproval("scalaflow-mock", false)).toBe(false);
    const input = missionToJobInput(mission, ORG_ID);
    expect(input.idempotencyKey).toBe(MISSION_ID);

    // 2. O executor MOCK executa a consulta de estatísticas.
    const result = await scalaflowMock.execute(input.params);
    expect(result.mock).toBe(true);
    expect(result.stats).toEqual({
      total_posts: 42,
      posts_today: 3,
      status: "ok",
    });

    // 3. O resultado é apresentado à ATHENA no vocabulário dela.
    expect(hubStatusToMissionStatus("COMPLETED")).toBe("SUCCEEDED");
    const presented = await buildMissionResponse(
      {
        ...(makeJob("COMPLETED") as unknown as JobDTO),
        result,
      },
      MISSION_ID,
      { requiresHumanApproval: false },
    );
    expect(presented.status).toBe("SUCCEEDED");
    expect(presented.hub_status).toBe("COMPLETED");
    expect(presented.result).toEqual(result);
    expect(presented.mission_id).toBe(MISSION_ID);
  });

  it("params inválidos para o mock → validação falha, nada executa", () => {
    expect(scalaflowMock.validateParams({ query: "apagar-tudo" }).ok).toBe(
      false,
    );
  });

  it("tool inexistente → sem adapter; missão exige aprovação por omissão segura", () => {
    expect(toolRegistry.adapterFor("tool-inexistente")).toBeUndefined();
    expect(resolveRequiresApproval("tool-inexistente", undefined)).toBe(true);
    expect(() =>
      resolveRequiresApproval("tool-inexistente", false),
    ).toThrowError(expect.objectContaining({ code: "CONFLICT" }));
  });
});
