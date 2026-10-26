/**
 * Testes das rotas ATHENA ↔ HUB (FASE 8) com service/auth mockados.
 * `npx vitest run tests/athena-bridge.test.ts`
 *
 * Cobre: auth (sem chave → 401; anti-replay real → 401 REPLAY_DETECTED),
 * validação de payload (400), idempotência (mesmo mission_id → mesmo job),
 * 409 em divergência de aprovação e GET de estado (200/404/400).
 *
 * O anti-replay usa a implementação REAL de lib/api-keys (em memória);
 * o contrato do repo devolve 401 REPLAY_DETECTED (não 403).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HubError } from "@/lib/errors";
import { checkReplayProtection, sha256Hex } from "@/lib/api-keys";
import type { JobDTO } from "@/lib/jobs/service";

const ORG_ID = "0e2b12d4-d36d-4b54-b58b-5ebf3ba8af0a";
const MISSION_ID = "9c2e7d1b-3f5a-4c0e-8f9a-2c1e5b4d9c0e";

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: () => ({ allowed: true, headers: {} }),
  rateLimitIdentity: () => "test-identity",
}));

vi.mock("@/lib/api-auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/api-auth")>();
  return {
    ...actual,
    // Delega: sem Bearer → 401 real; com Bearer → contexto m2m fixo.
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
        scopes: ["jobs:read", "jobs:write"],
        integrationId: "integration-athena",
      };
    }),
  };
});

// Idempotência simulada em memória: (orgId:idempotencyKey) → job.
const store = new Map<string, JobDTO>();
let jobCounter = 0;

function makeJob(status: JobDTO["status"]): JobDTO {
  jobCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(jobCounter).padStart(12, "0")}`,
    orgId: ORG_ID,
    toolId: "vectorcraft",
    status,
    params: { prompt: "logo minimalista de cafeteria" },
    idempotencyKey: MISSION_ID,
    createdBy: "integration-athena",
    createdAt: "2026-10-18T12:00:00.000Z",
    updatedAt: "2026-10-18T12:01:00.000Z",
    errorMessage: null,
    result: null,
    integrationStatus: "pending",
    startedAt: null,
  };
}

const { createJobMock, getJobAssetsMock, findJobByMissionIdMock } = vi.hoisted(
  () => ({
    createJobMock: vi.fn(),
    getJobAssetsMock: vi.fn(),
    findJobByMissionIdMock: vi.fn(),
  }),
);

vi.mock("@/lib/jobs/service", () => ({
  createJob: createJobMock,
  getJobAssets: getJobAssetsMock,
}));

// Gate agente↔ferramenta mockado como PERMITIDO: este ficheiro prova a
// ponte Athena (missão → job); a enforcement do gate é provada em
// lib/athena/agent-intake.test.ts e tests/athena-agent-intake-route.test.ts.
vi.mock("@/lib/athena/agent-intake", () => ({
  authorizeMissionToolAccess: vi.fn(async () => ({
    allowed: true,
    reason: "allowed",
  })),
}));

vi.mock("@/lib/athena/missions", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/athena/missions")>();
  return { ...actual, findJobByMissionId: findJobByMissionIdMock };
});

import { POST as missionsPost } from "@/app/api/v1/athena/missions/route";
import { GET as missionGet } from "@/app/api/v1/athena/missions/[id]/route";

function authHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({
    authorization: "Bearer hub_live_teste",
    "x-request-timestamp": String(Math.floor(Date.now() / 1000)),
    "x-nonce": crypto.randomUUID(),
    "content-type": "application/json",
    ...extra,
  });
}

function postRequest(body: unknown, headers?: Headers): NextRequest {
  return new NextRequest("http://localhost/api/v1/athena/missions", {
    method: "POST",
    headers: headers ?? authHeaders(),
    body: JSON.stringify(body),
  });
}

function getRequest(missionId: string, withOrg = true): NextRequest {
  const url =
    `http://localhost/api/v1/athena/missions/${missionId}` +
    (withOrg ? `?orgId=${ORG_ID}` : "");
  return new NextRequest(url, { headers: authHeaders() });
}

beforeEach(() => {
  store.clear();
  jobCounter = 0;
  vi.clearAllMocks();
  createJobMock.mockImplementation(
    async (input: { orgId: string; idempotencyKey: string }) => {
      const key = `${input.orgId}:${input.idempotencyKey}`;
      const existing = store.get(key);
      if (existing) return { job: existing, created: false };
      const job = makeJob("PENDING_APPROVAL");
      store.set(key, job);
      return { job, created: true };
    },
  );
  getJobAssetsMock.mockResolvedValue([]);
  findJobByMissionIdMock.mockResolvedValue(null);
});

describe("POST /api/v1/athena/missions", () => {
  it("sem chave → 401 UNAUTHORIZED", async () => {
    const res = await missionsPost(
      postRequest({ mission_id: MISSION_ID }, new Headers()),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: { code: string; requestId: string };
    };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(res.headers.get("x-request-id")).toBe(body.error.requestId);
  });

  it("payload inválido → 400 VALIDATION", async () => {
    const res = await missionsPost(
      postRequest({ mission_id: "nao-uuid", tool_id: "vectorcraft" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  it("cria o job preservando mission_id → 201", async () => {
    const res = await missionsPost(
      postRequest({
        mission_id: MISSION_ID,
        tool_id: "vectorcraft",
        org_id: ORG_ID,
        params: { prompt: "logo minimalista de cafeteria" },
        requires_human_approval: true,
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      mission: {
        mission_id: string;
        job_id: string;
        status: string;
        hub_status: string;
        awaiting_approval: boolean;
        approval: { decision_endpoint: string } | null;
      };
      deduplicated: boolean;
    };
    expect(body.deduplicated).toBe(false);
    expect(body.mission.mission_id).toBe(MISSION_ID);
    expect(body.mission.status).toBe("AWAITING_APPROVAL");
    expect(body.mission.hub_status).toBe("PENDING_APPROVAL");
    expect(body.mission.awaiting_approval).toBe(true);
    expect(body.mission.approval?.decision_endpoint).toContain(
      "/api/v1/approvals/",
    );
    // mission_id chegou ao service como idempotencyKey
    expect(createJobMock).toHaveBeenCalledTimes(1);
    const input = createJobMock.mock.calls[0][0] as {
      idempotencyKey: string;
    };
    expect(input.idempotencyKey).toBe(MISSION_ID);
  });

  it("idempotência: mesmo mission_id → mesmo job (200 + deduplicated)", async () => {
    const payload = {
      mission_id: MISSION_ID,
      tool_id: "vectorcraft",
      params: { prompt: "logo minimalista de cafeteria" },
      requires_human_approval: true,
    };
    const first = await missionsPost(postRequest(payload));
    const second = await missionsPost(postRequest(payload));
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    const b1 = (await first.json()) as {
      mission: { job_id: string };
      deduplicated: boolean;
    };
    const b2 = (await second.json()) as {
      mission: { job_id: string };
      deduplicated: boolean;
    };
    expect(b1.deduplicated).toBe(false);
    expect(b2.deduplicated).toBe(true);
    expect(b2.mission.job_id).toBe(b1.mission.job_id);
  });

  it("requires_human_approval divergente → 409 CONFLICT", async () => {
    const res = await missionsPost(
      postRequest({
        mission_id: MISSION_ID,
        tool_id: "vectorcraft",
        params: { prompt: "x" },
        requires_human_approval: false, // vectorcraft exige true
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("CONFLICT");
    expect(createJobMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/v1/athena/missions/[id]", () => {
  it("sem chave → 401", async () => {
    const req = new NextRequest(
      `http://localhost/api/v1/athena/missions/${MISSION_ID}`,
    );
    const res = await missionGet(req, {
      params: Promise.resolve({ id: MISSION_ID }),
    });
    expect(res.status).toBe(401);
  });

  it("mission_id inválido → 400", async () => {
    const res = await missionGet(getRequest("nao-uuid"), {
      params: Promise.resolve({ id: "nao-uuid" }),
    });
    expect(res.status).toBe(400);
  });

  it("missão inexistente → 404 NOT_FOUND", async () => {
    const res = await missionGet(getRequest(MISSION_ID), {
      params: Promise.resolve({ id: MISSION_ID }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("missão existente → 200 com estado mapeado e correlação", async () => {
    const job = makeJob("PENDING_APPROVAL");
    findJobByMissionIdMock.mockResolvedValue(job);
    const res = await missionGet(getRequest(MISSION_ID), {
      params: Promise.resolve({ id: MISSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mission: {
        mission_id: string;
        job_id: string;
        status: string;
        hub_status: string;
        awaiting_approval: boolean;
      };
    };
    expect(body.mission.mission_id).toBe(MISSION_ID);
    expect(body.mission.job_id).toBe(job.id);
    expect(body.mission.status).toBe("AWAITING_APPROVAL");
    expect(body.mission.hub_status).toBe("PENDING_APPROVAL");
    expect(body.mission.awaiting_approval).toBe(true);
    expect(findJobByMissionIdMock).toHaveBeenCalledWith(MISSION_ID, ORG_ID);
  });

  it("SUCCEEDED expõe result e assets", async () => {
    const job = makeJob("COMPLETED");
    job.result = { ok: true };
    findJobByMissionIdMock.mockResolvedValue(job);
    getJobAssetsMock.mockResolvedValue([
      {
        id: "a1",
        kind: "output_image",
        url: "https://cdn.exemplo.com/logo.png",
        metadata: {},
      },
    ]);
    const res = await missionGet(getRequest(MISSION_ID, false), {
      params: Promise.resolve({ id: MISSION_ID }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mission: {
        status: string;
        result: unknown;
        assets: Array<{ url: string }>;
      };
    };
    expect(body.mission.status).toBe("SUCCEEDED");
    expect(body.mission.result).toEqual({ ok: true });
    expect(body.mission.assets).toHaveLength(1);
    expect(body.mission.assets[0].url).toBe(
      "https://cdn.exemplo.com/logo.png",
    );
  });
});

describe("anti-replay (implementação real)", () => {
  it("nonce repetido → 401 REPLAY_DETECTED", () => {
    const headers = new Headers({
      "x-request-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-nonce": crypto.randomUUID(),
    });
    const fp = sha256Hex("chave-ficticia");
    expect(checkReplayProtection(headers, fp)).toEqual({ ok: true });
    try {
      checkReplayProtection(headers, fp);
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      const hub = err as HubError;
      expect(hub.code).toBe("REPLAY_DETECTED");
      expect(hub.status).toBe(401);
    }
  });

  it("timestamp fora da janela → 401", () => {
    const headers = new Headers({
      "x-request-timestamp": "1",
      "x-nonce": crypto.randomUUID(),
    });
    expect(() =>
      checkReplayProtection(headers, sha256Hex("outra-chave")),
    ).toThrowError(HubError);
  });
});
