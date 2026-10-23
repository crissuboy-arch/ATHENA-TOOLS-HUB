"use client";

import * as React from "react";
import Link from "next/link";
import {
  StatCard,
  StatCardSkeleton,
  Card,
  CardTitle,
  StateBadge,
  EmptyState,
  EmptyIcon,
  Spinner,
  Button,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  useApiList,
  type ApiListState,
  type ApiRecord,
} from "@/components/api";
import { useOrg } from "@/components/org";
import { withOrg } from "@/lib/api-client";
import type { Org } from "@/lib/workflow-models";

/**
 * Dashboard — fed ONLY by real GET requests to /api/v1/*.
 * Response parsing + retry live in @/components/api; anything the API
 * doesn't return is "no data", never invented.
 *
 * FASE 2B (compatibilidade com a C1 da Fase 2A): a chamada a
 * GET /api/v1/tools envia o `orgId` da organização ATIVA (useOrg, o
 * mesmo contexto das outras páginas) — desde a C1 a rota exige a org e
 * responde 400 sem ela / 403 para orgs alheias. Sem org selecionada,
 * mantém-se a chamada sem orgId e o erro honesto da API (nunca dados
 * de outra organização).
 */

const str = (row: ApiRecord, ...keys: string[]): string => {
  for (const key of keys) {
    const v = row[key];
    if (typeof v === "string" && v) return v;
  }
  return String(row.id ?? "—");
};

const ACTIVE_JOB_STATES = new Set(["running", "queued", "waiting_approval"]);

function StatIcon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="h-5 w-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function Section({
  title,
  href,
  loading,
  error,
  onRetry,
  children,
}: {
  title: string;
  href: string;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <CardTitle>{title}</CardTitle>
        <Link
          href={href}
          className="shrink-0 text-sm font-semibold text-gold-600 hover:text-gold-700"
        >
          {t.common.viewAll} →
        </Link>
      </div>
      {loading ? (
        <div className="flex items-center gap-3 py-6 text-sm text-ink-500">
          <Spinner size="sm" /> {t.common.loading}
        </div>
      ) : error ? (
        <div role="alert" className="py-6 text-center">
          <p className="text-sm text-danger-600">{t.dashboard.loadError}</p>
          <Button variant="ghost" size="sm" onClick={onRetry} className="mt-3">
            {t.common.retry}
          </Button>
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

function JobRow({ row }: { row: ApiRecord }) {
  const state = String(row.status ?? row.state ?? "created");
  const id = row.id !== null && row.id !== undefined ? String(row.id) : null;
  const body = (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-900">
          {str(row, "name", "title", "tool_name")}
        </p>
        <p className="text-xs text-ink-500">
          {String(row.created_at ?? row.updated_at ?? "")}
        </p>
      </div>
      <StateBadge kind="job" state={state} />
    </>
  );
  return (
    <li className="border-b border-ink-100 last:border-0">
      {id ? (
        <Link
          href={`/jobs/${encodeURIComponent(id)}`}
          className="flex items-center justify-between gap-3 py-3 transition-colors hover:bg-mist"
          aria-label={`Abrir tarefa ${id}`}
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center justify-between gap-3 py-3">{body}</div>
      )}
    </li>
  );
}

export default function DashboardClient({ orgs }: { orgs: Org[] }) {
  const { orgId } = useOrg(orgs);
  // FASE 2B: tools com o orgId da org ativa (exigido desde a C1).
  const tools = useApiList(
    orgId ? withOrg("/api/v1/tools", orgId) : "/api/v1/tools"
  );
  const integrations = useApiList("/api/v1/integrations");
  const jobs = useApiList("/api/v1/jobs?limit=10");
  const approvals = useApiList("/api/v1/approvals?limit=10");
  const results = useApiList("/api/v1/results?limit=10");

  const activeJobs = jobs.items.filter((j) =>
    ACTIVE_JOB_STATES.has(String(j.status ?? j.state ?? ""))
  );
  const pendingApprovals = approvals.items.filter(
    (a) => String(a.status ?? a.state ?? "") === "pending"
  );
  const connectedIntegrations = integrations.items.filter(
    (i) => String(i.status ?? i.state ?? "") === "connected"
  );

  const statProps = (api: ApiListState, count: number) => ({
    loading: api.loading,
    error: api.error,
    value: api.loading || api.error ? undefined : count,
    subtitle:
      !api.loading && !api.error && api.items.length === 0
        ? t.dashboard.noData
        : undefined,
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink-900">
          {t.dashboard.title}
        </h1>
        <p className="mt-1 text-sm text-ink-500">{t.dashboard.subtitle}</p>
      </div>

      {/* Stats */}
      <section
        aria-label={t.dashboard.subtitle}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        {tools.loading ? (
          <StatCardSkeleton />
        ) : (
          <StatCard
            title={t.dashboard.stats.tools}
            href="/catalog"
            icon={
              <StatIcon>
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </StatIcon>
            }
            {...statProps(tools, tools.total ?? 0)}
          />
        )}
        {integrations.loading ? (
          <StatCardSkeleton />
        ) : (
          <StatCard
            title={t.dashboard.stats.integrations}
            href="/integrations"
            icon={
              <StatIcon>
                <path d="M9 17H7a5 5 0 0 1 0-10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
              </StatIcon>
            }
            {...statProps(integrations, connectedIntegrations.length)}
          />
        )}
        {jobs.loading ? (
          <StatCardSkeleton />
        ) : (
          <StatCard
            title={t.dashboard.stats.activeJobs}
            href="/jobs"
            icon={
              <StatIcon>
                <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H13L13 2z" />
              </StatIcon>
            }
            {...statProps(jobs, activeJobs.length)}
          />
        )}
        {approvals.loading ? (
          <StatCardSkeleton />
        ) : (
          <StatCard
            title={t.dashboard.stats.pendingApprovals}
            href="/approvals"
            icon={
              <StatIcon>
                <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 0 1-18 0 9 9 0 0 1 18 0z" />
              </StatIcon>
            }
            {...statProps(approvals, pendingApprovals.length)}
          />
        )}
      </section>

      {/* Lists */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Section
          title={t.dashboard.recentJobs}
          href="/jobs"
          loading={jobs.loading}
          error={jobs.error}
          onRetry={jobs.reload}
        >
          {jobs.items.length === 0 ? (
            <EmptyState icon={<EmptyIcon />} title={t.dashboard.emptyJobs} />
          ) : (
            <ul>
              {jobs.items.slice(0, 5).map((row, i) => (
                <JobRow key={String(row.id ?? i)} row={row} />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t.dashboard.runningJobs}
          href="/jobs"
          loading={jobs.loading}
          error={jobs.error}
          onRetry={jobs.reload}
        >
          {activeJobs.length === 0 ? (
            <EmptyState icon={<EmptyIcon />} title={t.dashboard.emptyJobs} />
          ) : (
            <ul>
              {activeJobs.slice(0, 5).map((row, i) => (
                <JobRow key={String(row.id ?? i)} row={row} />
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t.dashboard.pendingApprovals}
          href="/approvals"
          loading={approvals.loading}
          error={approvals.error}
          onRetry={approvals.reload}
        >
          {pendingApprovals.length === 0 ? (
            <EmptyState icon={<EmptyIcon />} title={t.dashboard.emptyApprovals} />
          ) : (
            <ul>
              {pendingApprovals.slice(0, 5).map((row, i) => (
                <li
                  key={String(row.id ?? i)}
                  className="flex items-center justify-between gap-3 border-b border-ink-100 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {str(row, "name", "title", "job_name")}
                    </p>
                    <p className="text-xs text-ink-500">
                      {String(row.created_at ?? row.requested_at ?? "")}
                    </p>
                  </div>
                  <StateBadge kind="approval" state="pending" />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title={t.dashboard.recentResults}
          href="/results"
          loading={results.loading}
          error={results.error}
          onRetry={results.reload}
        >
          {results.items.length === 0 ? (
            <EmptyState icon={<EmptyIcon />} title={t.dashboard.emptyResults} />
          ) : (
            <ul>
              {results.items.slice(0, 5).map((row, i) => (
                <li
                  key={String(row.id ?? i)}
                  className="flex items-center justify-between gap-3 border-b border-ink-100 py-3 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink-900">
                      {str(row, "name", "title", "job_name")}
                    </p>
                    <p className="text-xs text-ink-500">
                      {String(row.created_at ?? row.finished_at ?? "")}
                    </p>
                  </div>
                  <StateBadge
                    kind="job"
                    state={String(row.status ?? row.state ?? "completed")}
                  />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}
