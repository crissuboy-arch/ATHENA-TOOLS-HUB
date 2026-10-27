"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiGet,
  apiList,
  withOrg,
  DB_NOT_CONFIGURED_MESSAGE,
  isDbNotConfigured,
  ApiError,
} from "@/lib/api-client";
import {
  JOB_STATES,
  JOB_STATE_LABELS,
  formatDateTime,
  shortId,
  type Job,
  type JobState,
  type Org,
  type Tool,
} from "@/lib/workflow-models";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  PageHeader,
  Pagination,
  Select,
  table,
} from "@/components/workflows-ui";
import { NoOrgState, OrgSelect, useOrg } from "@/components/org";
import JobStateBadge from "@/components/jobs/JobStateBadge";
import { t } from "@/lib/i18n";

const PER_PAGE = 20;

export default function JobsClient({ orgs }: { orgs: Org[] }) {
  const router = useRouter();
  const { orgId, setOrgId, ready } = useOrg(orgs);

  const [status, setStatus] = useState<"" | JobState>("");
  const [toolId, setToolId] = useState("");
  const [page, setPage] = useState(1);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);

  // Tool catalog for the filter + resolving tool names (the job DTO has no name).
  useEffect(() => {
    if (!orgId) return;
    apiGet<{ tools: Tool[] }>(withOrg("/tools", orgId))
      .then((body) => setTools(body.tools ?? []))
      .catch(() => setTools([]));
  }, [orgId]);

  const toolNames = useMemo(() => {
    const map = new Map<string, string>();
    // toolId do job é o slug (legado: uuid) — indexa por ambos.
    for (const t of tools) {
      map.set(t.id, t.name);
      if (t.slug) map.set(t.slug, t.name);
    }
    return map;
  }, [tools]);

  // Pure data fetch (no setState inside): safe to call from effects via
  // .then() callbacks (React 19 lint rule) and from event handlers.
  const fetchJobs = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      perPage: String(PER_PAGE),
    });
    if (status) params.set("status", status);
    if (toolId) params.set("toolId", toolId);
    const { items, page: pg } = await apiList<Job>(
      withOrg(`/jobs?${params.toString()}`, orgId as string),
    );
    return { items, total: pg.total };
  }, [orgId, page, status, toolId]);

  const applyJobs = useCallback((data: Awaited<ReturnType<typeof fetchJobs>>) => {
    setJobs(data.items);
    setTotal(data.total);
    setError(null);
  }, []);

  const applyJobsError = useCallback((err: unknown) => {
    setError(
      isDbNotConfigured(err)
        ? DB_NOT_CONFIGURED_MESSAGE
        : err instanceof ApiError
          ? err.message
          : "Não foi possível carregar as tarefas.",
    );
    setJobs([]);
    setTotal(0);
  }, []);

  // setState only inside .then()/.catch()/.finally() callbacks (permitted);
  // the loading flag is reset by the filter-change handlers below.
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    fetchJobs()
      .then((data) => {
        if (!cancelled) applyJobs(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) applyJobsError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, fetchJobs, applyJobs, applyJobsError]);

  function beginReload() {
    setLoading(true);
  }

  function changeStatus(v: "" | JobState) {
    beginReload();
    setStatus(v);
    setPage(1);
  }
  function changeTool(v: string) {
    beginReload();
    setToolId(v);
    setPage(1);
  }
  function changePage(p: number) {
    beginReload();
    setPage(p);
  }
  function clearFilters() {
    beginReload();
    setStatus("");
    setToolId("");
    setPage(1);
  }

  /** Retry after a load error — re-runs the real GET, never invents data. */
  function retryLoad() {
    setLoading(true);
    fetchJobs()
      .then((data) => {
        applyJobs(data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        applyJobsError(err);
        setLoading(false);
      });
  }

  const hasActiveFilters = status !== "" || toolId !== "";

  if (!ready) return <LoadingState label="Carregando…" />;
  if (orgs.length === 0) return <NoOrgState />;

  return (
    <div>
      <PageHeader
        title="Tarefas"
        subtitle="Execuções de ferramentas: acompanhe estados, parâmetros e resultados."
        actions={
          <>
            <OrgSelect orgs={orgs} orgId={orgId} onChange={setOrgId} />
            <Link href="/jobs/new">
              <Button tone="gold">+ Nova tarefa</Button>
            </Link>
          </>
        }
      />

      <Card className="mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Estado" htmlFor="f-status">
            <Select
              id="f-status"
              value={status}
              onChange={(e) => changeStatus(e.target.value as "" | JobState)}
            >
              <option value="">Todos</option>
              {JOB_STATES.map((s) => (
                <option key={s} value={s}>
                  {JOB_STATE_LABELS[s]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Ferramenta" htmlFor="f-tool">
            <Select id="f-tool" value={toolId} onChange={(e) => changeTool(e.target.value)}>
              <option value="">Todas</option>
              {tools.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              tone="secondary"
              onClick={clearFilters}
              disabled={!hasActiveFilters}
            >
              Limpar filtros
            </Button>
          </div>
        </div>
      </Card>

      {error ? (
        <div>
          <Alert tone="danger" title="Erro ao carregar">
            {error}
          </Alert>
          <div className="mt-3">
            <Button tone="secondary" onClick={retryLoad}>
              {t.common.retry}
            </Button>
          </div>
        </div>
      ) : loading ? (
        <LoadingState label="Carregando tarefas…" />
      ) : jobs.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? "Nenhuma tarefa encontrada" : "Nenhuma tarefa ainda"}
          description={
            hasActiveFilters
              ? "Ajuste os filtros para ver mais resultados."
              : "Crie a primeira tarefa para executar uma ferramenta do catálogo."
          }
          action={
            <Link href="/jobs/new">
              <Button tone="gold">+ Nova tarefa</Button>
            </Link>
          }
        />
      ) : (
        <Card>
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>ID</th>
                  <th className={table.th}>Ferramenta</th>
                  <th className={table.th}>Estado</th>
                  <th className={table.th}>Criada por</th>
                  <th className={table.th}>Criada em</th>
                  <th className={table.th}>Atualizada em</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    className={table.rowClickable}
                    onClick={() => router.push(`/jobs/${job.id}`)}
                  >
                    <td className={table.td}>
                      <span className="font-mono text-xs text-navy-900 [.dark_&]:text-gold-300">
                        {shortId(job.id)}
                      </span>
                    </td>
                    <td className={table.td}>{toolNames.get(job.toolId) ?? job.toolId}</td>
                    <td className={table.td}>
                      <JobStateBadge state={job.status} />
                    </td>
                    <td className={table.td}>{job.createdBy || "—"}</td>
                    <td className={table.td}>{formatDateTime(job.createdAt)}</td>
                    <td className={table.td}>{formatDateTime(job.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {!loading && !error && total > 0 ? (
        <Pagination page={page} perPage={PER_PAGE} total={total} onChange={changePage} />
      ) : null}
    </div>
  );
}
