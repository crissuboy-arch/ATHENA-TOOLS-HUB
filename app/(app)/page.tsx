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
} from "@/components/ui";
import { t } from "@/lib/i18n";

/**
 * Dashboard — fed ONLY by real GET requests to /api/v1/*.
 *
 * Expected API shapes (implemented by the API agent): an array, or an
 * object with { data } / { items } / { results } plus optional
 * { total } / { count }. Anything else is treated as "no data", never
 * invented.
 */

type ApiRecord = Record<string, unknown>;

interface ApiState {
  items: ApiRecord[];
  total: number | null;
  loading: boolean;
  error: boolean;
}

function parseList(json: unknown): ApiRecord[] {
  if (Array.isArray(json)) return json as ApiRecord[];
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["data", "items", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as ApiRecord[];
    }
  }
  return [];
}

function parseTotal(json: unknown, items: ApiRecord[]): number | null {
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    for (const key of ["total", "count"]) {
      if (typeof obj[key] === "number") return obj[key] as number;
    }
  }
  return items.length;
}

function useApiList(url: string): ApiState {
  const [state, setState] = React.useState<ApiState>({
    items: [],
    total: null,
    loading: true,
    error: false,
  });

  // No synchronous setState in the effect body (React 19 lint rule):
  // every setState below happens after an `await`, inside the async
  // continuation. Initial useState({ loading: true }) covers first paint;
  // `url` never changes for these dashboard tiles.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const items = parseList(json);
        if (!cancelled) {
          setState({
            items,
            total: parseTotal(json, items),
            loading: false,
            error: false,
          });
        }
      } catch {
        if (!cancelled) {
          setState({ items: [], total: null, loading: false, error: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

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
  children,
}: {
  title: string;
  href: string;
  loading: boolean;
  error: boolean;
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
        <p role="alert" className="py-6 text-center text-sm text-danger-600">
          {t.dashboard.loadError}
        </p>
      ) : (
        children
      )}
    </Card>
  );
}

function JobRow({ row }: { row: ApiRecord }) {
  const state = String(row.status ?? row.state ?? "created");
  return (
    <li className="flex items-center justify-between gap-3 border-b border-ink-100 py-3 last:border-0">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-900">
          {str(row, "name", "title", "tool_name")}
        </p>
        <p className="text-xs text-ink-500">
          {String(row.created_at ?? row.updated_at ?? "")}
        </p>
      </div>
      <StateBadge kind="job" state={state} />
    </li>
  );
}

export default function DashboardPage() {
  const tools = useApiList("/api/v1/tools");
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

  const statProps = (api: ApiState, count: number) => ({
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
                <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
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
