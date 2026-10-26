-- ===========================================================================
-- ATHENA TOOLS HUB — 0012_integration_agent_link.sql
-- Opção A (decisão da proprietária, 26/10/2026): vínculo integração↔agente
-- para a verificação de permissões agente↔ferramenta na intake de missões.
--
-- STATUS — READ BEFORE RUNNING — PREPARADO, NÃO APLICADO:
--   * This file was PREPARED on 2026-10-26 from the approved architecture
--     decision (docs/ATHENA_AGENT_TOOL_SCHEMA_DECISION.md, Opção A). The
--     architecture is APPROVED; the application of this migration is NOT
--     AUTHORIZED. It has NOT been applied to any database — not
--     production, not staging, not local. No SQL from this file was run
--     against any database during its preparation.
--   * Applying it is a separate, explicit decision by the owner
--     (Cristiane), executed manually in the Supabase SQL editor, in
--     numeric order, after 0001–0011 — exactly like every previous
--     migration gate. Code in this repo works WITHOUT this migration:
--     the agent gate in lib/athena/agent-intake.ts denies (fail-closed)
--     when the column does not exist, instead of crashing or allowing.
--   * A migration that is applied is never edited afterwards. If this
--     file needs a change after application, that change is a NEW
--     migration, reviewed and authorized separately.
--
-- WHAT THIS ADDS (additive only, no backfill, no data changes)
--   * public.integrations.agent_id — UUID, NULLABLE, REFERENCES
--     public.agents (id) ON DELETE SET NULL. One agent per integration,
--     matching the real model of today (one Athena key per integration).
--     Existing integrations keep working: NULL means "no agent linked"
--     and the gate denies agent-scoped missions for that integration
--     until a human links it — the default is never permissive.
--   * Index integrations_agent_idx on (agent_id) for the intake lookup.
--   * Nothing else: the uuid→slug resolution used by the gate needs NO
--     schema change — public.tools.slug already exists since 0001, and
--     agent_tool_permissions (0008) already carries allowed / scopes /
--     max_cost_cents. RLS on integrations is unchanged by adding a
--     nullable column (the table's existing policies keep applying).
--
-- ROLLBACK (described, NOT created, NOT applied):
--   * Branch-level rollback right now: nothing was merged, deployed or
--     applied — do not merge this branch, or delete it.
--   * If this migration is applied in the future and must be reverted,
--     the rollback is ANOTHER migration (e.g. 0013) that drops the
--     column — never an edit of this file, never a manual DROP outside
--     a reviewed migration. Dropping the column returns the gate to
--     fail-closed denial (column missing = denied), which is safe but
--     blocks agent-scoped missions until re-linked — so the rollback
--     itself also needs the owner's explicit authorization.
--
-- Re-runnable: IF NOT EXISTS throughout, in the style of 0001–0011.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- integrations.agent_id — Opção A (nullable, no backfill)
-- ---------------------------------------------------------------------------
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS agent_id uuid
    REFERENCES public.agents (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS integrations_agent_idx
  ON public.integrations (agent_id);

COMMENT ON COLUMN public.integrations.agent_id IS
  'Opção A (26/10/2026, PREPARADA — aplicação NÃO autorizada): agente que
   uma integração representa, para a verificação agente↔ferramenta na
   intake de missões (lib/athena/agent-intake.ts). NULL = sem agente
   vinculado = missões com verificação por agente são NEGADAS
   (fail-closed), nunca permitidas por omissão.';
