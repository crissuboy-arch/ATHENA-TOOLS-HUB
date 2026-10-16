import { createHash } from "node:crypto";

/**
 * Athena Tools Hub — rate limiter token-bucket em memória para /api/v1.
 *
 * Escopo: por chave de API (m2m) ou por IP (sessão de usuário).
 * Limites padrão: 120 requisições / 60s por identidade.
 *
 * NOTA DE ESCALA: o estado é por instância. Em deploy multi-instância,
 * migrar para Redis (mesma interface: checkRateLimit retorna headers).
 * Headers emitidos: X-RateLimit-Limit, X-RateLimit-Remaining,
 * X-RateLimit-Reset (unix) e Retry-After (em 429).
 */

interface Bucket {
  tokens: number;
  resetAt: number; // epoch ms
}

const buckets = new Map<string, Bucket>();

const WINDOW_MS = 60_000;
const MAX_TOKENS = 120;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch seconds
  retryAfterSeconds?: number;
  headers: Record<string, string>;
}

function prune(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function checkRateLimit(identity: string): RateLimitResult {
  const now = Date.now();
  if (buckets.size > 50_000) prune(now);

  let bucket = buckets.get(identity);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { tokens: MAX_TOKENS, resetAt: now + WINDOW_MS };
    buckets.set(identity, bucket);
  }

  const resetSeconds = Math.ceil(bucket.resetAt / 1000);
  if (bucket.tokens <= 0) {
    const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    return {
      allowed: false,
      limit: MAX_TOKENS,
      remaining: 0,
      resetAt: resetSeconds,
      retryAfterSeconds: retryAfter,
      headers: {
        "X-RateLimit-Limit": String(MAX_TOKENS),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(resetSeconds),
        "Retry-After": String(retryAfter),
      },
    };
  }

  bucket.tokens -= 1;
  return {
    allowed: true,
    limit: MAX_TOKENS,
    remaining: bucket.tokens,
    resetAt: resetSeconds,
    headers: {
      "X-RateLimit-Limit": String(MAX_TOKENS),
      "X-RateLimit-Remaining": String(bucket.tokens),
      "X-RateLimit-Reset": String(resetSeconds),
    },
  };
}

/** Chave do limiter: usa a chave de API quando presente, senão o IP. */
export function rateLimitIdentity(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (match) {
    // Não armazenar a chave crua como identidade: hash SHA-256.
    return `key:${sha256Hex(match[1])}`;
  }
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return `ip:${ip}`;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
