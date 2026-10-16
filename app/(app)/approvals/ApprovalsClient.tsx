"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  formatDateTime,
  shortId,
  type Job,
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
  Pagination,
  Tabs,
  TextArea,
  table,
} from "@/components/workflows-ui";
import { NoOrgState, OrgSelect, useOrg } from "@/components/org";

const PER_PAGE = 20;

type Tab = "pending" | "history";
type Decision = "approve" | "reject";

function paramsPreview(params: Record<string, unknown>): string {
  const text = JSON.stringify(params);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export default function ApprovalsClient({ orgs }: { orgs: Org[] }) {
  const { orgId, setOrgId, ready } = useOrg(orgs);
  const [tab, setTab] = useState<Tab>("pending");
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tools, setTools] = useState<Tool[]>([]);

  const [decisionTarget, setDecisionTarget] = useState<{ job: Job; decision: Decision } | null>(null);
  const [justification, setJustification] = useState("");
  const [justificationError, setJustificationError] = useState<string | null>(null);
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    apiGet<{ tools: Tool[] }>("/tools")
      .then((body) => setTools(body.tools ?? []))
      .catch(() => setTools([]));
  }, [orgId]);

  const toolNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tools) map.set(t.id, t.name);
    return map;
  }, [tools]);

  const load = useCallback(async () => {
    if (!orgId || tab !== "pending") return;
    setLoading(true);
    setError(null);
    try {
      // The approvals queue IS the list of jobs in PENDING_APPROVAL.
      const { items: fetched, page: pg } = await apiList<Job>(
        withOrg(`/approvals?page=${page}&perPage=${PER_PAGE}`, orgId),
      );
      setItems(fetched);
      setTotal(pg.total);
    } catch (err) {
      setError(
        isDbNotConfigured(err)
          ? DB_NOT_CONFIGURED_MESSAGE
          : err instanceof ApiError
            ? err.message
            : "Não foi possível carregar as aprovações.",
      );
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [orgId, tab, page]);

  useEffect(() => {
    void load();
  }, [load]);

  function openDecision(job: Job, decision: Decision) {
    setDecisionTarget({ job, decision });
    setJustification("");
    setJustificationError(null);
  }

  async function submitDecision() {
    if (!decisionTarget || !orgId) return;
    if (justification.trim().length < 1) {
      setJustificationError("A justificativa é obrigatória.");
      return;
    }
    setDeciding(true);
    try {
      await apiPost(withOrg(`/approvals/${decisionTarget.job.id}/decision`, orgId), {
        orgId,
        decision: decisionTarget.decision,
        justification: justification.trim(),
      });
      setDecisionTarget(null);
      await load();
    } catch (err) {
      setJustificationError(
        err instanceof ApiError ? err.message : "Não foi possível registrar a decisão.",
      );
    } finally {
      setDeciding(false);
    }
  }

  if (!ready) return <LoadingState label="Carregando…" />;
  if (orgs.length === 0) return <NoOrgState />;

  return (
    <div>
      <PageHeader
        title="Aprovações"
        subtitle="Tarefas aguardando decisão humana antes de executar. Aprovar libera para a fila; rejeitar cancela."
        actions={<OrgSelect orgs={orgs} orgId={orgId} onChange={setOrgId} />}
      />

      <Tabs
        tabs={[
          { id: "pending", label: "Pendentes" },
          { id: "history", label: "Histórico" },
        ]}
        activeId={tab}
        onChange={(id) => {
          setTab(id as Tab);
          setPage(1);
        }}
      />

      {tab === "history" ? (
        <Alert tone="neutral" title="Histórico em breve">
          A API ainda não expõe o histórico de decisões (aprovador, justificativa e data). As
          decisões ficam registradas na auditoria do servidor e na linha do tempo de cada tarefa.
        </Alert>
      ) : error ? (
        <Alert tone="danger" title="Erro ao carregar">
          {error}
        </Alert>
      ) : loading ? (
        <LoadingState label="Carregando aprovações…" />
      ) : items.length === 0 ? (
        <EmptyState
          title="Nenhuma aprovação pendente"
          description="Não há tarefas aguardando aprovação nesta organização no momento."
        />
      ) : (
        <Card>
          <div className={table.wrapper}>
            <table className={table.table}>
              <thead className={table.thead}>
                <tr>
                  <th className={table.th}>Tarefa</th>
                  <th className={table.th}>Ferramenta</th>
                  <th className={table.th}>Solicitante</th>
                  <th className={table.th}>Solicitada em</th>
                  <th className={table.th}>Parâmetros</th>
                  <th className={table.th}>Ações</th>
                </tr>
              </thead>
              <tbody className={table.tbody}>
                {items.map((job) => (
                  <tr key={job.id}>
                    <td className={table.td}>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="font-mono text-xs text-navy-900 hover:underline [.dark_&]:text-gold-300"
                      >
                        {shortId(job.id)}
                      </Link>
                    </td>
                    <td className={table.td}>{toolNames.get(job.toolId) ?? job.toolId}</td>
                    <td className={table.td}>{job.createdBy || "—"}</td>
                    <td className={table.td}>{formatDateTime(job.createdAt)}</td>
                    <td className={table.td}>
                      <code
                        className="block max-w-xs truncate font-mono text-xs text-ink-500"
                        title={JSON.stringify(job.params, null, 2)}
                      >
                        {paramsPreview(job.params)}
                      </code>
                    </td>
                    <td className={table.td}>
                      <div className="flex gap-2">
                        <Button tone="primary" onClick={() => openDecision(job, "approve")}>
                          Aprovar
                        </Button>
                        <Button tone="danger" onClick={() => openDecision(job, "reject")}>
                          Rejeitar
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "pending" && !loading && !error && total > 0 ? (
        <Pagination page={page} perPage={PER_PAGE} total={total} onChange={setPage} />
      ) : null}

      <Modal
        open={decisionTarget !== null}
        title={decisionTarget?.decision === "approve" ? "Aprovar tarefa" : "Rejeitar tarefa"}
        onClose={() => setDecisionTarget(null)}
        footer={
          <>
            <Button tone="secondary" onClick={() => setDecisionTarget(null)} disabled={deciding}>
              Cancelar
            </Button>
            <Button
              tone={decisionTarget?.decision === "approve" ? "primary" : "danger"}
              onClick={submitDecision}
              disabled={deciding}
            >
              {deciding
                ? "Registrando…"
                : decisionTarget?.decision === "approve"
                  ? "Confirmar aprovação"
                  : "Confirmar rejeição"}
            </Button>
          </>
        }
      >
        <p className="mb-4 text-sm text-ink-700 [.dark_&]:text-ink-100">
          {decisionTarget?.decision === "approve"
            ? "A tarefa será liberada para a fila de execução. "
            : "A tarefa será cancelada e não será executada. "}
          Descreva o motivo da decisão — a justificativa fica registrada na auditoria.
        </p>
        <Field label="Justificativa" htmlFor="decision-justification" error={justificationError}>
          <TextArea
            id="decision-justification"
            rows={4}
            placeholder="Ex.: parâmetros conferidos, custo dentro do esperado…"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
