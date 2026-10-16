/**
 * Degradação honesta sem Supabase configurado (nenhum projeto Supabase
 * dedicado existe por regra — estes testes NUNCA tocam rede nem credenciais
 * reais; apenas removem as env vars e verificam o comportamento).
 *
 * Esperado:
 *  - isSupabaseConfigured() → false
 *  - GET /api/v1/health → 200 com supabase: "not-configured"
 *  - service.listJobs → HubError SUPABASE_NOT_CONFIGURED (503)
 *  - GET /api/v1/tools sem auth → 401 UNAUTHORIZED (a autenticação corre
 *    ANTES da checagem de configuração; nenhuma chave é inventada)
 *
 * Nenhum teste faz login real, chama a API do Supabase ou usa credenciais.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { NextRequest } from "next/server";
import { HubError } from "@/lib/errors";
import { isSupabaseConfigured } from "@/lib/supabase";
import { listJobs } from "@/lib/jobs/service";
import { GET as healthGet } from "@/app/api/v1/health/route";
import { GET as toolsGet } from "@/app/api/v1/tools/route";

const ENVS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const key of ENVS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENVS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe("sem env vars do Supabase", () => {
  it("isSupabaseConfigured() retorna false", () => {
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("GET /api/v1/health → 200 com supabase: 'not-configured'", async () => {
    const res = await healthGet();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; supabase: string };
    expect(body.status).toBe("ok");
    expect(body.supabase).toBe("not-configured");
  });

  it("service.listJobs → 503 SUPABASE_NOT_CONFIGURED (sem tocar na rede)", async () => {
    try {
      await listJobs({
        orgId: "550e8400-e29b-41d4-a716-446655440000",
        page: 1,
        perPage: 20,
      });
      expect.unreachable("deveria ter lançado");
    } catch (err) {
      expect(err).toBeInstanceOf(HubError);
      const hub = err as HubError;
      expect(hub.code).toBe("SUPABASE_NOT_CONFIGURED");
      expect(hub.status).toBe(503);
    }
  });

  it("GET /api/v1/tools sem auth → 401 UNAUTHORIZED (auth precede a checagem de config)", async () => {
    const request = new Request("http://localhost/api/v1/tools") as NextRequest;
    const res = await toolsGet(request);
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: { code: string; message: string; requestId: string };
    };
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(typeof body.error.requestId).toBe("string");
  });

  it("resposta 503/401 segue a forma { error: { code, message, requestId } } sem stack", async () => {
    const request = new Request("http://localhost/api/v1/tools") as NextRequest;
    const res = await toolsGet(request);
    const text = await res.text();
    expect(text).not.toContain("stack");
    expect(res.headers.get("x-request-id")).not.toBeNull();
  });
});
