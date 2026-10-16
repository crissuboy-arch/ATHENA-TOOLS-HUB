"use client";

import { useEffect, useState } from "react";
import type { Org } from "@/lib/workflow-models";
import { Select } from "./workflows-ui";
import { EmptyState } from "./workflows-ui";

const STORAGE_KEY = "ath-org-id";

/**
 * Resolves the active org for the workflows UI.
 * Real memberships come from the server (getOrgs); the user's choice
 * persists in localStorage. Nothing is invented.
 */
export function useOrg(orgs: Org[]): {
  orgId: string | null;
  orgs: Org[];
  setOrgId: (id: string) => void;
  ready: boolean;
} {
  const [orgId, setOrgIdState] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* storage indisponível */
    }
    if (stored && orgs.some((o) => o.id === stored)) {
      setOrgIdState(stored);
    } else if (orgs.length > 0) {
      setOrgIdState(orgs[0].id);
    } else {
      setOrgIdState(null);
    }
    setReady(true);
  }, [orgs]);

  function setOrgId(id: string) {
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
    setOrgIdState(id);
  }

  return { orgId, orgs, setOrgId, ready };
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
