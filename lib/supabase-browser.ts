"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client for auth flows (login, logout).
 * Returns null when Supabase env vars are missing — callers must render
 * the honest "setup required" state instead of failing.
 */
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createBrowserClient(url, anonKey);
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}
