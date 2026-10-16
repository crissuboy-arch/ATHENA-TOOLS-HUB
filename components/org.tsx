"use client";

import { useCallback } from "react";
import type { Org } from "@/lib/workflow-models";
import { useLocalStorageValue } from "@/lib/use-local-storage";
import { Select } from "./workflows-ui";
import { EmptyState } from "./workflows-ui";

const STORAGE_KEY = "ath-org-id";

/**
 * Resolves the active org for the workflows UI.
 * Real memberships come from the server (getOrgs); the user's choice
 * persists in localStorage. Nothing is invented.
 *
 * The stored id is read via useSyncExternalStore (SSR-safe, no
 * set-state-in-effect): server renders the fallback, the client reconciles
 * without a hydration warning. `ready` is therefore always true — the gate
 * it used to provide is no longer needed.
 */
export function useOrg(orgs: Org[]): {
  orgId: string | null;
  orgs: Org[];
  setOrgId: (id: string) => void;
  ready: boolean;
} {
  const [storedId, setStoredId] = useLocalStorageValue(STORAGE_KEY);

  const orgId =
    storedId && orgs.some((o) => o.id === storedId)
      ? storedId
      : orgs.length > 0
        ? orgs[0].id
        : null;

  const setOrgId = useCallback(
    (id: string) => setStoredId(id),
    [setStoredId],
  );

  return { orgId, orgs, setOrgId, ready: true };
}

/** Org switcher — rendered only when the user belongs to more than one org. */
export function OrgSelect({
  orgs,
  orgId,
  onChange,
}: {
  orgs: Org[];
  orgId: string | null;
  onChange: (id: string) => void;
}) {
  if (orgs.length <= 1) return null;
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-ink-500 [.dark_&]:text-ink-300">Organização</span>
      <Select
        aria-label="Organização"
        value={orgId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className="w-auto"
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </Select>
    </label>
  );
}

/** Honest state when the user has no organization (or the DB is unreachable). */
export function NoOrgState() {
  return (
    <EmptyState
      title="Nenhuma organização encontrada"
      description="Sua conta não está vinculada a nenhuma organização, ou o banco de dados está indisponível. Verifique seu acesso e recarregue a página."
    />
  );
}
