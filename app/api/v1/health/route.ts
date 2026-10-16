/**
 * GET /api/v1/health — sem autenticação.
 * { status: 'ok', version, supabase: 'configured' | 'not-configured', timestamp }
 */

import { newRequestId } from "@/lib/errors";
import { apiJson } from "@/lib/api-response";
import { isSupabaseConfigured } from "@/lib/auth";
import pkg from "@/package.json";

export async function GET() {
  const requestId = newRequestId();
  return apiJson(
    {
      status: "ok",
      version: pkg.version,
      supabase: isSupabaseConfigured() ? "configured" : "not-configured",
      timestamp: new Date().toISOString(),
    },
    { requestId },
  );
}
