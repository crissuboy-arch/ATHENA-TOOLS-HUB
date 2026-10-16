"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setUnauthorizedHandler } from "@/lib/api-client";

/**
 * Registers the router-based 401 handler for the API client, once per app
 * shell mount. Keeps window.location out of lib/api-client (Next.js lint
 * rule) while preserving the "session expired → login" behavior.
 */
export function AuthRedirectRegistrar() {
  const router = useRouter();

  useEffect(() => {
    // No setState here — only registers an external callback.
    setUnauthorizedHandler(() => {
      router.push("/login");
    });
    return () => setUnauthorizedHandler(null);
  }, [router]);

  return null;
}
