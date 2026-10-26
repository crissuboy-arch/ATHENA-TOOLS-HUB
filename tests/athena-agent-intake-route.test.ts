/**
 * ATHENA — gate agente↔ferramenta LIGADO à rota real de missões.
 *
 * Prova, através do `POST /api/v1/athena/missions` real (auth e jobs
 * service mockados, como no teste do pipeline), que:
 * - gate permitido → 201 e job criado;
 * - gate negado (sem agente, schema indisponível, tool não associada)
 *   → 403 FORBIDDEN estruturado, job NUNCA criado, nunca 500.
 *
 * O gate em si é mockado aqui por decisão deliberada: a lógica do gate
 * (resolução, uuid→slug, fail-closed) é provada sem mocks em
 * `lib/athena/agent-intake.test.ts`. Este ficheiro prova a LIGAÇÃO —
 * que a rota consulta o gate antes de criar o job e respeita a negação.
 *
 * `npx vitest run tests/athena-agent-intake-route.test.ts`
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { HubError } from "@/lib/errors";

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

const gateState = vi.hoisted(() => ({
  decision: { allowed: true, reason: "allowed" } as {
    allowed: boolean;
    reason: string;
  },
}));

vi.mock("@/lib/athena/agent-intake", () => ({
  authorizeMissionToolAccess: vi.fn(async () => gateState.decision),
}));

const createJobMock = vi.hoisted(() =>
  vi.fn(async (input: Record<string, unknown>) => ({
    job: {
      id: "00000000-0000-4000-8000-000000000001",
      orgId: ORG_ID,
      toolId: input.toolId,
      status: "QUEUED",
      params: input.params,
      idempotencyKey: input.idempotencyKey,
      createdBy: "",
      createdAt: "2026-10-26T00:00:00.000Z",
      updatedAt: "2026-10-26T00:00:00.000Z",
      errorMessage: null,
      result: null,
      integrationStatus: "pending",
      startedAt: null,
    },
    created: true,
  })),
);

vi.mock("@/lib/jobs/service", () => ({
  integrationStatusFor: () => "pending",
  createJob: createJobMock,
  getJob: vi.fn(async () => {
    throw HubError.notFound("Job");
  }),
  getJobAssets: vi.fn(async () => []),
}));

import { POST as postMission } from "@/app/api/v1/athena/missions/route";

function missionRequest(body: Record<string, unknown>) {
  return new NextRequest("http://hub.test/api/v1/athena/missions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer hub_live_test",
    },
    body: JSON.stringify(body),
  });
}

function missionBody() {
  return {
    mission_id: MISSION_ID,
    tool_id: "vectorcraft",
    params: {},
  };
}

beforeEach(() => {
  createJobMock.mockClear();
  gateState.decision = { allowed: true, reason: "allowed" };
});

describe("gate agente↔ferramenta na rota de missões", () => {
  it("gate permitido → 201 e job criado", async () => {
    const res = await postMission(missionRequest(missionBody()));
    expect(res.status).toBe(201);
    expect(createJobMock).toHaveBeenCalledTimes(1);
  });

  it("integração sem agente → 403 FORBIDDEN, job nunca criado", async () => {
    gateState.decision = { allowed: false, reason: "no-agent-linked" };
    const res = await postMission(missionRequest(missionBody()));
    expect(res.status).toBe(403);
    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe("FORBIDDEN");
    expect(payload.error.message).toContain("no-agent-linked");
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it("schema indisponível (0012 por aplicar) → 403, nunca 500, job nunca criado", async () => {
    gateState.decision = {
      allowed: false,
      reason: "agent-schema-unavailable",
    };
    const res = await postMission(missionRequest(missionBody()));
    expect(res.status).toBe(403);
    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe("FORBIDDEN");
    expect(payload.error.message).toContain("agent-schema-unavailable");
    expect(createJobMock).not.toHaveBeenCalled();
  });

  it("tool não associada ao agente → 403, job nunca criado", async () => {
    gateState.decision = {
      allowed: false,
      reason: "no-agent-permission-row",
    };
    const res = await postMission(missionRequest(missionBody()));
    expect(res.status).toBe(403);
    const payload = (await res.json()) as {
      error: { code: string; message: string };
    };
    expect(payload.error.code).toBe("FORBIDDEN");
    expect(createJobMock).not.toHaveBeenCalled();
  });
});
