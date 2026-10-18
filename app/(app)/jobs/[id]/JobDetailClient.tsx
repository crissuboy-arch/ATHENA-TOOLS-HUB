"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiGet,
  apiList,
  apiPost,
  withOrg,
  ApiError,
  DB_NOT_CONFIGURED_MESSAGE,
  isDbNotConfigured,
} from "@/lib/api-client";
import {
  CANCELLABLE_STATES,
  formatDateTime,
  newIdempotencyKey,
  shortId,
  type Asset,
  type Job,
  type JobEvent,
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
  Modal,
  PageHeader,
  TextArea,
  JsonViewer,
  CopyButton,
} from "@/components/workflows-ui";
import { NoOrgState, OrgSelect, useOrg } from "@/components/org";
import JobStateBadge from "@/components/jobs/JobStateBadge";
import JobTimeline from "@/components/jobs/JobTimeline";
import { t } from "@/lib/i18n";

export default function JobDetailClient({
  id,
  orgs,
  deduplicated,
}: {
  id: string;
  orgs: Org[];
  deduplicated: boolean;
}) {
  const router = useRouter();
  const { orgId, setOrgId, ready } = useOrg(orgs);

  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [toolName, setToolName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Pure data fetch (no setState inside): safe to call from effects via
  // .then() callbacks (React 19 lint rule) and from event handlers.
  const fetchDetail = useCallback(async () => {
    const [jobBody, eventsBody] = await Promise.all([
      apiGet<{ job: Job }>(withOrg(`/jobs/${id}`, orgId as string)),
      apiList<JobEvent>(withOrg(`/jobs/${id}/events`, orgId as string)),
    ]);
    let assets: Asset[] = [];
    try {
      const assetsBody = await apiGet<{ assets: Asset[] }>(
        withOrg(`/jobs/${id}/assets`, orgId as string),
      );
      assets = assetsBody.assets ?? [];
    } catch {
      /* assets stay empty */
    }
    let toolName: string | null = null;
    try {
      const toolsBody = await apiGet<{ tools: Tool[] }>("/tools");
      toolName = (toolsBody.tools ?? []).find((t) => t.id === jobBody.job.toolId)?.name ?? null;
    } catch {
      /* toolName stays null */
    }
    return { job: jobBody.job, events: eventsBody.items, assets, toolName };
  }, [id, orgId]);

  const applyDetail = useCallback((data: Awaited<ReturnType<typeof fetchDetail>>) => {
    setJob(data.job);
    setEvents(data.events);
    setAssets(data.assets);
    setToolName(data.toolName);
    setNotFound(false);
    setError(null);
  }, []);

  const applyDetailError = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 404) {
      setNotFound(true);
    } else {
      setError(
        isDbNotConfigured(err)
          ? DB_NOT_CONFIGURED_MESSAGE
          : err instanceof ApiError
            ? err.message
            : "Não foi possível carregar a tarefa.",
      );
    }
  }, []);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    fetchDetail()
      .then((data) => {
        if (!cancelled) applyDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) applyDetailError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, fetchDetail, applyDetail, applyDetailError]);

  async function cancelJob() {
    if (!job || !orgId) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiPost(withOrg(`/jobs/${job.id}/cancel`, orgId), {
        orgId,
        ...(cancelReason.trim() ? { reason: cancelReason.trim() } : {}),
      });
      setConfirmCancel(false);
      setCancelReason("");
      setLoading(true);
      try {
        applyDetail(await fetchDetail());
      } catch (err) {
        applyDetailError(err);
      } finally {
        setLoading(false);
      }
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Não foi possível cancelar a tarefa.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  /** Retry after a load error — re-runs the real GETs, never invents data. */
  async function reloadDetail() {
    if (!orgId) return;
    setLoading(true);
    try {
      applyDetail(await fetchDetail());
    } catch (err) {
      applyDetailError(err);
    } finally {
      setLoading(false);
    }
  }

  async function retryJob() {    if (!job || !orgId) return;
    setActionBusy(true);
    setActionError(null);
    try {
      // Retry = a NEW job with the same params and a fresh idempotency key.
      // Nothing is duplicated blindly: the user confirms and the key is new.
      const body = await apiPost<{ job: Job }>("/jobs", {
        orgId,
        toolId: job.toolId,
        params: job.params,
        idempotencyKey: newIdempotencyKey(),
      });
      setConfirmRetry(false);
      router.push(`/jobs/${body.job.id}`);
    } catch (err) {
      setActionError(
        err instanceof ApiError ? err.message : "Não foi possível repetir a tarefa.",
      );
    } finally {
      setActionBusy(false);
    }
  }

  if (!ready) {
    return (
      <div>
        <PageHeader title="Tarefa" />
        <LoadingState label="Carregando…" />
      </div>
    );
  }
  if (orgs.length === 0) return <NoOrgState />;

  if (loading) {
    return (
      <div>
        <PageHeader title="Tarefa" />
        <LoadingState label="Carregando tarefa…" />
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <PageHeader title="Tarefa não encontrada" />
        <EmptyState
          title="Tarefa não encontrada"
          description="O ID informado não corresponde a nenhuma tarefa desta organização."
          action={
            <Link href="/jobs">
              <Button tone="secondary">← Voltar para tarefas</Button>
            </Link>
          }
        />
      </div>
    );
  }

  if (error || !job) {
    return (
      <div>
        <PageHeader title="Tarefa" />
        <Alert tone="danger" title="Erro ao carregar">
          {error ?? "Tarefa indisponível."}
        </Alert>
        <div className="mt-3">
          <Button tone="secondary" onClick={reloadDetail}>
            {t.common.retry}
          </Button>
        </div>
      </div>
    );
  }

  const cancellable = CANCELLABLE_STATES.includes(job.status);
  const retryable = job.status === "FAILED";

  return (
    <div>
      <PageHeader
        title={`Tarefa ${shortId(job.id)}`}
        subtitle={toolName ?? job.toolId}
        actions={
          <>
            <OrgSelect orgs={orgs} orgId={orgId} onChange={setOrgId} />
            <Link href="/jobs">
              <Button tone="secondary">← Tarefas</Button>
            </Link>
            {cancellable ? (
              <Button tone="danger" onClick={() => setConfirmCancel(true)}>
                Cancelar
              </Button>
            ) : null}
            {retryable ? (
              <Button tone="gold" onClick={() => setConfirmRetry(true)}>
                Repetir
              </Button>
            ) : null}
          </>
        }
      />

      {deduplicated ? (
        <div className="mb-4">
          <Alert tone="info" title="Tarefa já existente">
            A chave de idempotência informada já tinha criado esta tarefa — nenhum novo job foi
            criado.
          </Alert>
        </div>
      ) : null}

      {actionError ? (
        <div className="mb-4">
          <Alert tone="danger">{actionError}</Alert>
        </div>
      ) : null}

      {/* header */}
      <Card className="mb-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <JobStateBadge state={job.status} />
          <span className="font-mono text-xs text-ink-500">{job.id}</span>
          <CopyButton value={job.id} label="Copiar ID" />
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-ink-500 uppercase">Ferramenta</dt>
            <dd className="mt-0.5 text-sm text-ink-900 [.dark_&]:text-ink-100">
              {toolName ?? job.toolId}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-500 uppercase">Criada por</dt>
            <dd className="mt-0.5 text-sm text-ink-900 [.dark_&]:text-ink-100">
              {job.createdBy || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-500 uppercase">Criada em</dt>
            <dd className="mt-0.5 text-sm text-ink-900 [.dark_&]:text-ink-100">
              {formatDateTime(job.createdAt)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-500 uppercase">Atualizada em</dt>
            <dd className="mt-0.5 text-sm text-ink-900 [.dark_&]:text-ink-100">
              {formatDateTime(job.updatedAt)}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-500 uppercase">Chave de idempotência</span>
          <code className="rounded bg-mist px-2 py-1 font-mono text-xs text-ink-700 [.dark_&]:bg-navy-800 [.dark_&]:text-ink-100">
            {job.idempotencyKey}
          </code>
          <CopyButton value={job.idempotencyKey} />
        </div>
        {job.integrationStatus === "pending" ? (
          <div className="mt-4">
            <Alert tone="warning">
              Executor pendente para esta ferramenta — a tarefa está registrada, não executada.
            </Alert>
          </div>
        ) : null}
      </Card>

      {/* error panel */}
      {job.status === "FAILED" ? (
        <div className="mb-4">
          <Alert tone="danger" title="A tarefa falhou">
            {job.errorMessage ?? "O executor não retornou uma mensagem de erro."}
            <span className="mt-1 block text-xs opacity-80">
              Mensagem retornada pelo executor. Detalhes técnicos completos ficam no log do
              executor.
            </span>
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* timeline */}
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-navy-900 [.dark_&]:text-white">
            Linha do tempo
          </h2>
          <JobTimeline events={events} />
        </Card>

        {/* params */}
        <Card className="p-5">
          <h2 className="mb-4 text-base font-semibold text-navy-900 [.dark_&]:text-white">
            Parâmetros
          </h2>
          <JsonViewer value={job.params} />
        </Card>
      </div>

      {/* result */}
      {job.status === "COMPLETED" ? (
        <Card className="mt-4 p-5">
          <h2 className="mb-4 text-base font-semibold text-navy-900 [.dark_&]:text-white">
            Resultado
          </h2>
          {job.result === undefined || job.result === null ? (
            <p className="text-sm text-ink-500 [.dark_&]:text-ink-300">
              A tarefa foi concluída, mas o executor não retornou resultado.
            </p>
          ) : (
            <JsonViewer value={job.result} />
          )}
        </Card>
      ) : null}

      {/* assets */}
      {assets.length > 0 ? (
        <Card className="mt-4 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-navy-900 [.dark_&]:text-white">
              Arquivos gerados ({assets.length})
            </h2>
            <Link href="/results" className="text-sm font-medium text-gold-600 hover:underline">
              Ver em Resultados →
            </Link>
          </div>
          <ul className="divide-y divide-ink-100 [.dark_&]:divide-navy-700">
            {assets.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                <span className="truncate text-sm text-ink-900 [.dark_&]:text-ink-100">
                  {a.url.split("?")[0].split("/").pop() || a.id}
                </span>
                <a
                  href={a.url}
                  download
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-sm font-medium text-gold-600 hover:underline"
                >
                  Baixar
                </a>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* cancel modal */}
      <Modal
        open={confirmCancel}
        title="Cancelar tarefa"
        onClose={() => setConfirmCancel(false)}
        footer={
          <>
            <Button tone="secondary" onClick={() => setConfirmCancel(false)} disabled={actionBusy}>
              Manter tarefa
            </Button>
            <Button tone="danger" onClick={cancelJob} disabled={actionBusy}>
              {actionBusy ? "Cancelando…" : "Confirmar cancelamento"}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-ink-700 [.dark_&]:text-ink-100">
          Tem certeza que deseja cancelar a tarefa{" "}
          <span className="font-mono">{shortId(job.id)}</span>? A execução será interrompida e o
          estado passará para <strong>Cancelada</strong>. Esta ação não pode ser desfeita.
        </p>
        <Field label="Motivo (opcional)" htmlFor="cancel-reason">
          <TextArea
            id="cancel-reason"
            rows={3}
            placeholder="Ex.: parâmetros incorretos, solicitada por engano…"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
          />
        </Field>
      </Modal>

      {/* retry modal */}
      <Modal
        open={confirmRetry}
        title="Repetir tarefa"
        onClose={() => setConfirmRetry(false)}
        footer={
          <>
            <Button tone="secondary" onClick={() => setConfirmRetry(false)} disabled={actionBusy}>
              Voltar
            </Button>
            <Button tone="gold" onClick={retryJob} disabled={actionBusy}>
              {actionBusy ? "Criando…" : "Criar nova tarefa"}
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-700 [.dark_&]:text-ink-100">
          Isso cria uma <strong>nova tarefa</strong> com os mesmos parâmetros e uma nova chave de
          idempotência — a tarefa atual (falhada) permanece no histórico para auditoria.
        </p>
      </Modal>
    </div>
  );
}
