"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import {
  apiGet,
  apiPost,
  ApiError,
  DB_NOT_CONFIGURED_MESSAGE,
  isDbNotConfigured,
  withOrg,
} from "@/lib/api-client";
import {
  isToolOperational,
  isUuid,
  jobCreationGate,
  newIdempotencyKey,
  toolStatusLabel,
  type Job,
  type Org,
  type Tool,
} from "@/lib/workflow-models";
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  LoadingState,
  PageHeader,
  TextArea,
  TextInput,
  JsonViewer,
} from "@/components/workflows-ui";
import { NoOrgState, OrgSelect, useOrg } from "@/components/org";
import { t } from "@/lib/i18n";

const paramsObjectSchema = z.record(z.string(), z.unknown());

type Pair = { key: string; value: string };

function pairsToObject(pairs: Pair[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const p of pairs) {
    const key = p.key.trim();
    if (!key) continue;
    const raw = p.value.trim();
    if (raw === "") {
      obj[key] = "";
      continue;
    }
    try {
      obj[key] = JSON.parse(raw);
    } catch {
      obj[key] = p.value;
    }
  }
  return obj;
}

function objectToPairs(obj: Record<string, unknown>): Pair[] {
  return Object.entries(obj).map(([key, value]) => ({
    key,
    value: typeof value === "string" ? value : JSON.stringify(value),
  }));
}

const STEPS = ["Ferramenta", "Parâmetros", "Revisão"];

export default function NewJobClient({ orgs }: { orgs: Org[] }) {
  const router = useRouter();
  const { orgId, setOrgId, ready } = useOrg(orgs);
  const [step, setStep] = useState(1);

  const [tools, setTools] = useState<Tool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [selectedToolId, setSelectedToolId] = useState("");
  const [toolDetail, setToolDetail] = useState<Tool | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailNonce, setDetailNonce] = useState(0);

  const [pairs, setPairs] = useState<Pair[]>([]);
  const [raw, setRaw] = useState("{}");
  const [rawError, setRawError] = useState<string | null>(null);
  const [paramsObject, setParamsObject] = useState<Record<string, unknown>>({});

  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Pure data fetch (no setState inside): safe to call from effects via
  // .then() callbacks (React 19 lint rule) and from event handlers.
  const fetchTools = useCallback(async (): Promise<Tool[]> => {
    if (!orgId) return [];
    const body = await apiGet<{ tools: Tool[] }>(`/tools?orgId=${encodeURIComponent(orgId)}`);
    return body.tools ?? [];
  }, [orgId]);

  function toolsLoadErrorMessage(err: unknown): string {
    return isDbNotConfigured(err)
      ? DB_NOT_CONFIGURED_MESSAGE
      : err instanceof ApiError
        ? err.message
        : "Não foi possível carregar o catálogo de ferramentas.";
  }

  // Retry after a load error — re-runs the real GET, never invents data.
  // Event handler: synchronous setState is allowed here.
  const reloadTools = useCallback(() => {
    setToolsError(null);
    setTools(null);
    fetchTools()
      .then((t) => setTools(t))
      .catch((err: unknown) => setToolsError(toolsLoadErrorMessage(err)));
  }, [fetchTools]);

  useEffect(() => {
    let cancelled = false;
    fetchTools()
      .then((t) => {
        if (!cancelled) setTools(t);
      })
      .catch((err: unknown) => {
        if (!cancelled) setToolsError(toolsLoadErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [fetchTools]);

  const selectedTool: Tool | undefined = useMemo(
    () => tools?.find((t) => t.id === selectedToolId),
    [tools, selectedToolId],
  );

  // Detail carries integrationStatus ('ready' only when a real executor is connected).
  // No synchronous setState in the effect path (React 19 lint rule): the
  // "no selection" case is derived during render (effectiveDetail), and the
  // loading flag is raised by the selectTool event handler below.
  useEffect(() => {
    if (!selectedToolId || !orgId) return;
    let cancelled = false;
    // Detalhe exige orgId (C1): sem ele, a sessão devolve 400.
    // Erro no detalhe NÃO cai em fallback silencioso: sem detalhe não há
    // como confirmar o executor, por isso o gate bloqueia com erro
    // explícito (nunca "sem executor" inventado nem "operacional" assumido).
    apiGet<{ tool: Tool }>(
      withOrg(`/tools/${encodeURIComponent(selectedToolId)}`, orgId),
    )
      .then((body) => {
        if (!cancelled) {
          setToolDetail(body.tool);
          setDetailError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setToolDetail(null);
          setDetailError(
            err instanceof ApiError
              ? err.message
              : "Não foi possível confirmar se a ferramenta tem executor.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedToolId, selectedTool, orgId, detailNonce]);

  // Derived: no selection → no detail (instead of setToolDetail(null) in an effect).
  const effectiveDetail = selectedToolId ? toolDetail : null;
  const operational = effectiveDetail ? isToolOperational(effectiveDetail) : false;

  // Gate honesto: só avança com executor operacional confirmado. Sem
  // executor, a página NÃO induz a criar uma tarefa que nunca executa.
  const gate = jobCreationGate({
    selected: selectedToolId !== "",
    detailLoading,
    detailError: detailError !== null,
    operational,
  });
  const anyOperational =
    tools?.some((t) => t.integrationStatus === "ready") ?? false;

  function selectTool(id: string) {
    setDetailLoading(true);
    setToolDetail(null);
    setDetailError(null);
    setSelectedToolId(id);
  }

  function retryDetail() {
    setDetailError(null);
    setDetailLoading(true);
    setDetailNonce((n) => n + 1);
  }

  /* ----- params editor ----- */

  function syncFromPairs(next: Pair[]) {
    setPairs(next);
    const obj = pairsToObject(next);
    setParamsObject(obj);
    setRaw(JSON.stringify(obj, null, 2));
    setRawError(null);
  }

  function handleRawChange(text: string) {
    setRaw(text);
    try {
      const parsed: unknown = JSON.parse(text);
      const result = paramsObjectSchema.safeParse(parsed);
      if (!result.success) {
        setRawError("Os parâmetros devem ser um objeto JSON (chave: valor), não uma lista ou valor simples.");
        return;
      }
      setRawError(null);
      setParamsObject(result.data);
      setPairs(objectToPairs(result.data));
    } catch (e) {
      setRawError(`JSON inválido: ${e instanceof Error ? e.message : "erro de sintaxe"}`);
    }
  }

  function formatRaw() {
    if (rawError) return;
    setRaw(JSON.stringify(paramsObject, null, 2));
  }

  /* ----- submit ----- */

  async function submit() {
    if (!selectedTool || !orgId || submitting) return;
    if (!isUuid(idempotencyKey)) {
      setSubmitError("A chave de idempotência deve ser um UUID válido.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = await apiPost<{ job: Job; deduplicated: boolean }>("/jobs", {
        orgId,
        toolId: selectedTool.id,
        params: paramsObject,
        idempotencyKey: idempotencyKey.trim(),
      });
      const suffix = body.deduplicated ? "?deduplicated=1" : "";
      router.push(`/jobs/${body.job.id}${suffix}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError ? err.message : "Não foi possível criar a tarefa.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const canNextStep2 = rawError === null;

  if (!ready) return <LoadingState label="Carregando…" />;
  if (orgs.length === 0) return <NoOrgState />;

  return (
    <div>
      <PageHeader
        title="Nova tarefa"
        subtitle="Escolha a ferramenta, defina os parâmetros e revise antes de criar."
        actions={<OrgSelect orgs={orgs} orgId={orgId} onChange={setOrgId} />}
      />

      {/* step indicator */}
      <ol className="mb-6 flex flex-wrap items-center gap-2" aria-label="Etapas">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          return (
            <li key={label} className="flex items-center gap-2">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                  active
                    ? "bg-gold-500 text-navy-950"
                    : done
                      ? "bg-navy-900 text-white"
                      : "bg-ink-100 text-ink-500"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {n}
              </span>
              <span
                className={`text-sm ${active ? "font-semibold text-navy-900 [.dark_&]:text-white" : "text-ink-500"}`}
              >
                {label}
              </span>
              {n < STEPS.length ? <span className="mx-1 h-px w-8 bg-ink-100" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>

      {/* STEP 1 — pick tool */}
      {step === 1 && (
        <div>
          {toolsError ? (
            <div>
              <Alert tone="danger" title="Erro ao carregar ferramentas">
                {toolsError}
              </Alert>
              <div className="mt-3">
                <Button tone="secondary" onClick={reloadTools}>
                  {t.common.retry}
                </Button>
              </div>
            </div>
          ) : tools === null ? (
            <LoadingState label="Carregando ferramentas…" />
          ) : tools.length === 0 ? (
            <EmptyState
              title="Nenhuma ferramenta catalogada"
              description="O catálogo ainda não tem ferramentas. Volte quando o catálogo estiver preenchido."
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {tools.map((tool) => {
                const selected = tool.id === selectedToolId;
                return (
                  <button
                    key={tool.id}
                    type="button"
                    onClick={() => selectTool(tool.id)}
                    aria-pressed={selected}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      selected
                        ? "border-gold-500 bg-gold-100/40 shadow-sm [.dark_&]:bg-navy-800"
                        : "border-ink-100 bg-white hover:border-gold-300 [.dark_&]:border-navy-700 [.dark_&]:bg-navy-900"
                    }`}
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          tool.status === "operational-tested"
                            ? "success"
                            : tool.status === "error"
                              ? "danger"
                              : "warning"
                        }
                      >
                        {toolStatusLabel(tool.status)}
                      </Badge>
                      {/* Estado do executor (vem da lista v1, pelo slug). A
                          ferramenta continua visível sem executor — mas
                          ninguém a confunde com executável. */}
                      {tool.integrationStatus === "ready" ? (
                        <Badge tone="success">Executor conectado</Badge>
                      ) : tool.integrationStatus === "pending" ? (
                        <Badge tone="warning">Sem executor</Badge>
                      ) : null}
                      <span className="font-mono text-[11px] text-ink-500">v{tool.version}</span>
                    </div>
                    <h3 className="font-semibold text-navy-900 [.dark_&]:text-white">{tool.name}</h3>
                    <p className="mt-1 font-mono text-xs text-ink-500">{tool.id}</p>
                    {tool.description ? (
                      <p className="mt-2 line-clamp-3 text-sm text-ink-500 [.dark_&]:text-ink-300">
                        {tool.description}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}

          {selectedTool && detailError ? (
            <div className="mt-4">
              <Alert tone="danger" title="Não foi possível confirmar o executor">
                {detailError} Sem essa confirmação, a criação fica bloqueada — não
                vale a pena avançar às cegas.
              </Alert>
              <div className="mt-3">
                <Button tone="secondary" onClick={retryDetail}>
                  Tentar novamente
                </Button>
              </div>
            </div>
          ) : null}

          {selectedTool && gate.reason === "no-executor" ? (
            <div className="mt-4">
              <Alert tone="warning" title="Sem executor operacional">
                A ferramenta “{selectedTool.name}” não tem um executor real conectado,
                por isso não é possível criar uma tarefa executável para ela. A
                ferramenta continua no catálogo, mas criar agora só registaria
                uma tarefa que nunca seria executada.
                {!anyOperational
                  ? " Neste momento, nenhuma ferramenta do catálogo tem executor operacional."
                  : " Escolhe uma ferramenta com o selo “Executor conectado”."}
              </Alert>
            </div>
          ) : null}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Link href="/jobs" className="w-full sm:w-auto">
              <Button tone="secondary" className="w-full sm:w-auto">
                Cancelar
              </Button>
            </Link>
            <Button
              disabled={!gate.allowed}
              onClick={() => setStep(2)}
              className="w-full sm:w-auto"
            >
              Continuar →
            </Button>
          </div>
        </div>
      )}

      {/* STEP 2 — params */}
      {step === 2 && selectedTool && (
        <div>
          <Card className="p-5">
            <h2 className="mb-1 text-base font-semibold text-navy-900 [.dark_&]:text-white">
              Parâmetros — {selectedTool.name}
            </h2>
            <p className="mb-4 text-sm text-ink-500 [.dark_&]:text-ink-300">
              Adicione pares chave/valor ou edite o JSON diretamente. Os dois editores ficam
              sincronizados enquanto o JSON for válido.
            </p>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-ink-700 [.dark_&]:text-ink-100">
                    Chave / valor
                  </span>
                  <Button
                    tone="secondary"
                    onClick={() => syncFromPairs([...pairs, { key: "", value: "" }])}
                  >
                    + Adicionar
                  </Button>
                </div>
                {pairs.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-ink-100 p-4 text-sm text-ink-500">
                    Nenhum parâmetro. Adicione pares ou escreva o JSON ao lado.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {pairs.map((p, i) => (
                      <div key={i} className="flex flex-col gap-2 sm:flex-row">
                        <TextInput
                          placeholder="chave"
                          aria-label={`Chave ${i + 1}`}
                          value={p.key}
                          onChange={(e) => {
                            const next = pairs.slice();
                            next[i] = { ...p, key: e.target.value };
                            syncFromPairs(next);
                          }}
                        />
                        <TextInput
                          placeholder='valor (texto ou JSON: "abc", 10, true)'
                          aria-label={`Valor ${i + 1}`}
                          value={p.value}
                          onChange={(e) => {
                            const next = pairs.slice();
                            next[i] = { ...p, value: e.target.value };
                            syncFromPairs(next);
                          }}
                        />
                        <Button
                          tone="secondary"
                          aria-label={`Remover parâmetro ${i + 1}`}
                          onClick={() => syncFromPairs(pairs.filter((_, j) => j !== i))}
                          className="w-full sm:w-auto"
                        >
                          ×
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <Field
                  label="JSON bruto"
                  htmlFor="params-raw"
                  error={rawError}
                  hint={rawError ? undefined : "Objeto JSON válido ✓"}
                >
                  <TextArea
                    id="params-raw"
                    rows={12}
                    spellCheck={false}
                    value={raw}
                    onChange={(e) => handleRawChange(e.target.value)}
                    className="font-mono text-xs"
                  />
                </Field>
                <div className="mt-2">
                  <Button tone="secondary" onClick={formatRaw} disabled={rawError !== null}>
                    Formatar JSON
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              tone="secondary"
              onClick={() => setStep(1)}
              className="w-full sm:w-auto"
            >
              ← Voltar
            </Button>
            <Button
              disabled={!canNextStep2}
              onClick={() => setStep(3)}
              className="w-full sm:w-auto"
            >
              Revisar →
            </Button>
          </div>
        </div>
      )}

      {/* STEP 3 — review */}
      {step === 3 && selectedTool && (
        <div>
          <Card className="mb-4 p-5">
            <h2 className="mb-3 text-base font-semibold text-navy-900 [.dark_&]:text-white">Revisão</h2>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium text-ink-500 uppercase">Ferramenta</dt>
                <dd className="mt-0.5 text-sm font-medium text-ink-900 [.dark_&]:text-white">
                  {selectedTool.name}{" "}
                  <span className="font-mono text-xs text-ink-500">v{selectedTool.version}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-ink-500 uppercase">Executor</dt>
                <dd className="mt-0.5">
                  <Badge tone={operational ? "success" : "warning"}>
                    {operational ? "Conectado" : "Pendente"}
                  </Badge>
                </dd>
              </div>
            </dl>
            <div className="mt-4">
              <p className="mb-1 text-xs font-medium text-ink-500 uppercase">Parâmetros</p>
              <JsonViewer value={paramsObject} />
            </div>
            <div className="mt-4">
              <Field
                label="Chave de idempotência"
                htmlFor="idem-key"
                hint="Deve ser um UUID. Evita criar a tarefa duas vezes se o envio for repetido."
                error={!isUuid(idempotencyKey) ? "Formato inválido — use um UUID." : null}
              >
                <div className="flex gap-2">
                  <TextInput
                    id="idem-key"
                    value={idempotencyKey}
                    onChange={(e) => setIdempotencyKey(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button tone="secondary" onClick={() => setIdempotencyKey(newIdempotencyKey())}>
                    Gerar nova
                  </Button>
                </div>
              </Field>
            </div>
          </Card>

          {selectedTool && detailError ? (
            <div className="mb-4">
              <Alert tone="danger" title="Não foi possível confirmar o executor">
                {detailError} Volta ao passo da ferramenta e tenta novamente.
              </Alert>
            </div>
          ) : null}

          {selectedTool && gate.reason === "no-executor" ? (
            <div className="mb-4">
              <Alert tone="warning" title="Sem executor operacional">
                A ferramenta “{selectedTool.name}” não tem um executor real conectado.
                A criação está bloqueada: uma tarefa criada agora ficaria apenas
                registada, sem nunca ser executada.
              </Alert>
            </div>
          ) : null}

          {submitError ? (
            <div className="mb-4">
              <Alert tone="danger" title="Erro ao criar tarefa">
                {submitError}
              </Alert>
            </div>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              tone="secondary"
              onClick={() => setStep(2)}
              className="w-full sm:w-auto"
            >
              ← Voltar
            </Button>
            <Button
              tone="gold"
              onClick={submit}
              disabled={submitting || !isUuid(idempotencyKey) || !gate.allowed}
              className="w-full sm:w-auto"
            >
              {submitting ? "Criando…" : "Criar tarefa"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
