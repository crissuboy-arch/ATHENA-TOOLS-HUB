/**
 * ATHENA TOOLS HUB — Supabase clients.
 *
 * Three clients, three trust levels:
 *
 *   createClient()        browser client (anon key, RLS enforced per user)
 *   createServerClient()  server client bound to the request cookies
 *                         (anon key, RLS enforced per user) — ASYNC in Next.js 16
 *   createServiceClient() service_role client (BYPASSES RLS — server only,
 *                         callers must enforce org scoping in code)
 *
 * Honest degradation: when the env vars are missing (no dedicated Supabase
 * project connected yet), isSupabaseConfigured() returns false and every
 * creator throws a clear error. Server code MUST check
 * isSupabaseConfigured() and render the "not configured" state instead of
 * pretending data exists.
 *
 * Secrets: NEXT_PUBLIC_* values are safe for the browser. The service_role
 * key is server-only — never expose it to the client bundle.
 */

import { createBrowserClient, createServerClient as createSsrServerClient } from '@supabase/ssr';
import { createClient as createJsClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { Database } from './db-types';

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL is missing. ' +
        'See docs/SUPABASE_SETUP.md.'
    );
  }
  return url;
}

function supabaseAnonKey(): string {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      'Supabase is not configured: NEXT_PUBLIC_SUPABASE_ANON_KEY is missing. ' +
        'See docs/SUPABASE_SETUP.md.'
    );
  }
  return key;
}

/**
 * Returns true when the app has enough env to talk to Supabase.
 * All server code must degrade honestly when this is false:
 * show the "database not connected" state, never fake data.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

/**
 * Browser client — call from Client Components / browser code.
 * Auth session is stored in cookies; RLS applies per logged-in user.
 */
export function createClient(): SupabaseClient<Database> {
  return createBrowserClient<Database>(supabaseUrl(), supabaseAnonKey());
}

/**
 * Server client bound to the current request's cookies.
 *
 * NOTE (Next.js 16): `cookies()` is async, so this function is async —
 * server code must `await createServerClient()`.
 * RLS applies per logged-in user (anon key). Cookie writes are a no-op
 * when called from a Server Component (read-only context).
 */
export async function createServerClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();

  return createSsrServerClient<Database>(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component (read-only): session refresh
          // cannot write cookies here. Safe to ignore.
        }
      },
    },
  });
}

/**
 * Service-role client — BYPASSES RLS. Server only.
 *
 * Throws when SUPABASE_SERVICE_ROLE_KEY is missing (never ship a fallback).
 * Every caller MUST enforce org scoping in application logic, because RLS
 * will not do it for this client.
 */
export function createServiceClient(): SupabaseClient<Database> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      'Supabase service client unavailable: SUPABASE_SERVICE_ROLE_KEY is not set. ' +
        'This is server-only and must never be committed or exposed.'
    );
  }
  return createJsClient<Database>(supabaseUrl(), key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
