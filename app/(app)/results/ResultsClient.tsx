"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  apiGet,
  apiList,
  withOrg,
  ApiError,
  DB_NOT_CONFIGURED_MESSAGE,
  isDbNotConfigured,
} from "@/lib/api-client";
import {
  assetKindLabel,
  assetName,
  assetSize,
  formatBytes,
  formatDateTime,
  isImageKind,
  shortId,
  type Asset,
  type Job,
  type Org,
  type Tool,
} from "@/lib/workflow-models";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  LoadingState,
  Modal,
  PageHeader,
} from "@/components/workflows-ui";
import { NoOrgState, OrgSelect, useOrg } from "@/components/org";

const RECENT_JOBS = 20;

function KindIcon({ kind }: { kind: string }) {
  const cls = "text-gold-600";
  const k = kind.toLowerCase();
  if (k === "image") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="9" cy="10" r="1.6" fill="currentColor" />
        <path d="m5 18 5-5 3 3 3-3 3 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (k === "video") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" />
        <path d="M10 9.5v5l4.5-2.5L10 9.5Z" fill="currentColor" />
      </svg>
    );
  }
  if (k === "audio") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <path d="M4 10v4h3l4 4V6l-4 4H4Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M15 9a4 4 0 0 1 0 6M17.5 6.5a8 8 0 0 1 0 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (k === "data" || k === "json" || k === "csv") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
        <ellipse cx="12" cy="6" rx="7" ry="2.6" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 6v12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6" stroke="currentColor" strokeWidth="1.8" />
        <path d="M5 12c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className={cls} aria-hidden="true">
      <path d="M6 3h8l4 4v14H6V3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M14 3v4h4" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

export default function ResultsClient({ orgs }: { orgs: Org[] }) {
  const { orgId, setOrgId, ready } = useOrg(orgs);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Asset | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    try {
      // The API exposes assets per job only — aggregate the most recent
      // completed jobs. No global assets listing exists (honest, no invention).
      const [jobsBody, toolsBody] = await Promise.all([
        apiList<Job>(withOrg(`/jobs?status=COMPLETED&page=1&perPage=${RECENT_JOBS}`, orgId)),
        apiGet<{ tools: Tool[] }>("/tools").catch(() => ({ tools: [] as Tool[] })),
      ]);
      const toolNames = new Map((toolsBody.tools ?? []).map((t) => [t.id, t.name]));
      const settled = await Promise.all(
        jobsBody.items.map(async (job) => {
          try {
            const body = await apiGet<{ assets: Asset[] }>(withOrg(`/jobs/${job.id}/assets`, orgId));
            return (body.assets ?? []).map((a) => ({
              ...a,
              jobId: job.id,
              toolName: toolNames.get(job.toolId) ?? null,
            }));
          } catch {
            return [];
          }
        }),
      );
      setAssets(settled.flat());
    } catch (err) {
      setError(
        isDbNotConfigured(err)
          ? DB_NOT_CONFIGURED_MESSAGE
          : err instanceof ApiError
            ? err.message
            : "Não foi possível carregar os resultados.",
      );
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sorted = useMemo(
    () => assets.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [assets],
  );

  if (!ready) return <LoadingState label="Carregando…" />;
  if (orgs.length === 0) return <NoOrgState />;

  return (
    <div>
      <PageHeader
        title="Resultados"
        subtitle="Arquivos gerados pelas execuções: imagens, vídeos, documentos e dados."
        actions={<OrgSelect orgs={orgs} orgId={orgId} onChange={setOrgId} />}
      />

      {error ? (
        <Alert tone="danger" title="Erro ao carregar">
          {error}
        </Alert>
      ) : loading ? (
        <LoadingState label="Carregando resultados…" />
      ) : sorted.length === 0 ? (
        <EmptyState
          title="Nenhum resultado ainda"
          description="Quando uma tarefa concluída gerar arquivos, eles aparecerão aqui com download e pré-visualização."
        />
      ) : (
        <>
          <p className="mb-4 text-xs text-ink-500 [.dark_&]:text-ink-300">
            Mostrando arquivos dos {RECENT_JOBS} jobs concluídos mais recentes. A API ainda não
            oferece uma listagem global de arquivos.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sorted.map((asset) => {
              const name = assetName(asset);
              const showImage = isImageKind(asset.kind) && asset.url;
              return (
                <Card key={`${asset.jobId}-${asset.id}`} className="flex flex-col overflow-hidden">
                  {showImage ? (
                    <button
                      type="button"
                      onClick={() => setPreview(asset)}
                      className="block h-40 w-full cursor-zoom-in overflow-hidden bg-mist [.dark_&]:bg-navy-800"
                      aria-label={`Ampliar ${name}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={asset.url}
                        alt={name}
                        className="h-full w-full object-cover transition-transform hover:scale-105"
                        loading="lazy"
                      />
                    </button>
                  ) : (
                    <div className="flex h-40 items-center justify-center bg-mist [.dark_&]:bg-navy-800">
                      <KindIcon kind={asset.kind} />
                    </div>
                  )}

                  <div className="flex flex-1 flex-col p-4">
                    <p className="truncate text-sm font-semibold text-navy-900 [.dark_&]:text-white" title={name}>
                      {name}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500 [.dark_&]:text-ink-300">
                      {assetKindLabel(asset.kind)}
                      {asset.toolName ? ` · ${asset.toolName}` : ""}
                    </p>
                    <dl className="mt-3 space-y-1 text-xs text-ink-500 [.dark_&]:text-ink-300">
                      <div className="flex justify-between gap-2">
                        <dt>Criado em</dt>
                        <dd className="text-ink-700 [.dark_&]:text-ink-100">{formatDateTime(asset.createdAt)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Tamanho</dt>
                        <dd className="text-ink-700 [.dark_&]:text-ink-100">{formatBytes(assetSize(asset))}</dd>
                      </div>
                      {asset.jobId ? (
                        <div className="flex justify-between gap-2">
                          <dt>Tarefa</dt>
                          <dd>
                            <Link
                              href={`/jobs/${asset.jobId}`}
                              className="font-mono text-gold-600 hover:underline"
                            >
                              {shortId(asset.jobId)}
                            </Link>
                          </dd>
                        </div>
                      ) : null}
                    </dl>

                    <div className="mt-4 flex gap-2 pt-1">
                      <a
                        href={asset.url}
                        download
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-navy-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-navy-800 [.dark_&]:bg-gold-500 [.dark_&]:text-navy-950 [.dark_&]:hover:bg-gold-400"
                      >
                        Baixar
                      </a>
                      {showImage ? (
                        <Button tone="secondary" onClick={() => setPreview(asset)}>
                          Ampliar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      <Modal open={preview !== null} title={preview ? assetName(preview) : ""} onClose={() => setPreview(null)}>
        {preview?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt={assetName(preview)} className="max-h-[70vh] w-full rounded-lg object-contain" />
        ) : null}
      </Modal>
    </div>
  );
}
