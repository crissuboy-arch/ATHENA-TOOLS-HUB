-- ATHENA TOOLS HUB — 0003_seed.sql
-- Catalog seed with HONEST states only.
--
-- DESIGN DECISION (documented, 2026-10-16 security review):
--   The catalog is ORG-SCOPED, not global. Every org gets its own copy of
--   the catalog rows via public.seed_catalog(org_id), so each organization
--   has independent tool states (one org may have VectorCraft
--   'operational-tested' while another still has it 'in-development').
--   This matches the schema (tools.org_id NOT NULL) and the RLS model.
--   There is NO orphan 'default' organization: the seed attaches the catalog
--   to the organization created via public.bootstrap_organization().
--
-- Run AFTER 0002_rls.sql + 0005_security_hardening.sql, in the SQL editor:
--   SELECT public.seed_catalog('<org-id>');   -- org from bootstrap_organization()
--
-- Idempotent: re-running only refreshes DESCRIPTIVE fields (name,
-- description, category, repo_url, website_url). It NEVER touches `state`
-- (a real test result must never be demoted by a seed) and NEVER touches
-- `license` / `license_verified` (verified licenses are source-of-truth in
-- docs/CATALOG_LICENSES.md and must not be overwritten).
--
-- State rules for the initial seed:
--   * craft tools          -> 'in-development' (real repos exist, hub
--                             integration is not wired/tested yet)
--   * HyperFrames          -> 'cataloged'
--   * Apify MCP / Playwright CLI / Google Workspace CLI -> 'needs-config'
--                            (executors exist, credentials/config pending)
--   * NOTHING is seeded as 'connected' or 'operational-tested'.
--     A tool only reaches those states after a REAL passing test.
--
-- Licenses below are the VERIFIED values from docs/CATALOG_LICENSES.md
-- (checked 2026-10-16 against each repo's LICENSE file / GitHub license
-- field). storytold/artcraft-services (fair-source, NOT open source) and
-- storytold/artcraftx (no license) are DELIBERATELY EXCLUDED from the seed.

CREATE OR REPLACE FUNCTION public.seed_catalog(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_org_id IS NULL THEN
    RAISE EXCEPTION 'seed_catalog requires an organization id';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'seed_catalog: organization % does not exist', p_org_id;
  END IF;

  -- ------------------------------------------------------------------
  -- Craft tools (storytold/* — licenses VERIFIED, see docs/CATALOG_LICENSES.md)
  -- ------------------------------------------------------------------
  INSERT INTO public.tools
    (org_id, slug, name, description, category, state, license, license_verified, repo_url, website_url)
  VALUES
    (p_org_id, 'vectorcraft', 'VectorCraft',
     'Editor vetorial open-source (estilo Illustrator). Primeira candidata a execução real no Hub (adapter contract-first). Integração ainda não testada.',
     'design-vectors', 'in-development', 'MIT OR Apache-2.0', true,
     'https://github.com/storytold/vectorcraft', NULL),
    (p_org_id, 'designcraft', 'DesignCraft',
     'Diagramação e layout de páginas (estilo InDesign). Integração com o Hub ainda não testada.',
     'design-vectors', 'in-development', 'MIT OR Apache-2.0', true,
     'https://github.com/storytold/designcraft', NULL),
    (p_org_id, 'photocraft', 'PhotoCraft',
     'Editor de fotos open-source (estilo Photoshop). Integração com o Hub ainda não testada.',
     'image-photo', 'in-development', 'MIT OR Apache-2.0', true,
     'https://github.com/storytold/photocraft', NULL),
    (p_org_id, 'lightcraft', 'LightCraft',
     'Revelação RAW e biblioteca de fotos não-destrutiva (estilo Lightroom). Integração com o Hub ainda não testada.',
     'image-photo', 'in-development', 'MIT OR Apache-2.0', true,
     'https://github.com/storytold/lightcraft', NULL),
    (p_org_id, 'artcraft', 'ArtCraft',
     'IDE de criação com IA para imagem e vídeo (geração via provedores externos pagos). Integração com o Hub ainda não testada.',
     'image-photo', 'in-development', 'MIT OR Apache-2.0', true,
     'https://github.com/storytold/artcraft', 'https://getartcraft.com'),
    (p_org_id, 'wordcraft', 'WordCraft',
     'Processador de texto open-source (estilo Word). Integração com o Hub ainda não testada.',
     'documents', 'in-development', 'MIT OR Apache-2.0', true,
     'https://github.com/storytold/wordcraft', NULL)
  ON CONFLICT (org_id, slug) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    category    = EXCLUDED.category,
    repo_url    = EXCLUDED.repo_url,
    website_url = EXCLUDED.website_url,
    updated_at  = now();
  -- NOTE: `state`, `license` and `license_verified` are NEVER overwritten.
  -- A seed re-run must not demote a real test result nor clobber a verified
  -- license.

  -- ------------------------------------------------------------------
  -- HyperFrames (video render engine — Apache-2.0 VERIFIED)
  -- Renderizador de vídeo a partir de HTML/CSS. NÃO gera avatares de IA
  -- nativamente — nunca anunciar isso como capacidade.
  -- ------------------------------------------------------------------
  INSERT INTO public.tools
    (org_id, slug, name, description, category, state, license, license_verified, repo_url, website_url)
  VALUES
    (p_org_id, 'hyperframes', 'HyperFrames',
     'Renderizador de vídeo a partir de HTML/CSS/animação (MP4 determinístico). Apenas catalogado — nenhuma integração real testada ainda.',
     'video', 'cataloged', 'Apache-2.0', true,
     'https://github.com/heygen-com/hyperframes', NULL)
  ON CONFLICT (org_id, slug) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    category    = EXCLUDED.category,
    repo_url    = EXCLUDED.repo_url,
    website_url = EXCLUDED.website_url,
    updated_at  = now();

  -- ------------------------------------------------------------------
  -- Executors (need credentials/config before any real run; licenses of
  -- these CLIs were NOT individually verified — license stays NULL until
  -- a human reviews each repo's LICENSE file)
  -- ------------------------------------------------------------------
  INSERT INTO public.tools
    (org_id, slug, name, description, category, state, license, license_verified, repo_url, website_url)
  VALUES
    (p_org_id, 'apify-mcp', 'Apify MCP',
     'Servidor MCP oficial da Apify (Actors de scraping/automação). ATENÇÃO: a dona já paga Apify via ScalaFlow — não tocar nessa integração, não criar novas contas. Requer credenciais + teto de orçamento antes de qualquer execução.',
     'automation', 'needs-config', NULL, false,
     'https://github.com/apify/apify-mcp-server', 'https://mcp.apify.com'),
    (p_org_id, 'playwright-cli', 'Playwright CLI',
     'Automação de navegador real via Playwright CLI. Requer ambiente configurado antes de qualquer execução.',
     'automation', 'needs-config', NULL, false,
     'https://github.com/microsoft/playwright-cli', NULL),
    (p_org_id, 'google-workspace-cli', 'Google Workspace CLI',
     'CLI para Drive, Gmail, Calendar, Sheets, Docs (projeto da equipe de devs Google, pré-v1.0 — NÃO presumir produto oficial). Requer OAuth configurado; ações de escrita exigem aprovação.',
     'automation', 'needs-config', NULL, false,
     'https://github.com/googleworkspace/cli', NULL)
  ON CONFLICT (org_id, slug) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    category    = EXCLUDED.category,
    repo_url    = EXCLUDED.repo_url,
    website_url = EXCLUDED.website_url,
    updated_at  = now();

  -- ------------------------------------------------------------------
  -- Declared capabilities (contracts only — NOT proof of execution)
  -- ------------------------------------------------------------------
  INSERT INTO public.tool_capabilities (org_id, tool_id, name, description, input_schema, output_schema)
  SELECT p_org_id, t.id, c.name, c.description,
         (c.input_schema)::jsonb, (c.output_schema)::jsonb
  FROM public.tools t
  JOIN (VALUES
    -- VectorCraft (first real-execution candidate)
    ('vectorcraft', 'vectorize_image', 'Converte imagem raster em vetor editável.',
     '{"type":"object","properties":{"image_path":{"type":"string"}},"required":["image_path"]}',
     '{"type":"object","properties":{"svg_path":{"type":"string"}}}' ),
    ('vectorcraft', 'export_asset', 'Exporta ativo vetorial em formato final (SVG/PNG/PDF).',
     '{"type":"object","properties":{"asset_id":{"type":"string"},"format":{"type":"string"}}}',
     '{"type":"object","properties":{"file_path":{"type":"string"}}}' ),
    -- Craft tools: one declared capability each (integration untested)
    ('designcraft', 'create_design', 'Cria peça de design a partir de brief. Integração real ainda não testada.',
     '{"type":"object","properties":{"brief":{"type":"string"}}}',
     '{"type":"object","properties":{"asset_id":{"type":"string"}}}' ),
    ('photocraft', 'edit_photo', 'Edita foto a partir de instrução. Integração real ainda não testada.',
     '{"type":"object","properties":{"image_path":{"type":"string"},"instruction":{"type":"string"}}}',
     '{"type":"object","properties":{"file_path":{"type":"string"}}}' ),
    ('lightcraft', 'adjust_lighting', 'Ajusta iluminação de foto. Integração real ainda não testada.',
     '{"type":"object","properties":{"image_path":{"type":"string"},"preset":{"type":"string"}}}',
     '{"type":"object","properties":{"file_path":{"type":"string"}}}' ),
    ('artcraft', 'generate_art', 'Gera arte a partir de prompt (via provedores externos pagos). Integração real ainda não testada.',
     '{"type":"object","properties":{"prompt":{"type":"string"}}}',
     '{"type":"object","properties":{"file_path":{"type":"string"}}}' ),
    ('wordcraft', 'generate_copy', 'Gera texto/copy a partir de brief. Integração real ainda não testada.',
     '{"type":"object","properties":{"brief":{"type":"string"},"language":{"type":"string"}}}',
     '{"type":"object","properties":{"text":{"type":"string"}}}' ),
    -- HyperFrames (render engine — NOT an AI avatar generator)
    ('hyperframes', 'render_frames', 'Renderiza sequência de quadros para vídeo a partir de HTML/CSS. Não testado de ponta a ponta.',
     '{"type":"object","properties":{"scene":{"type":"object"}}}',
     '{"type":"object","properties":{"frames_path":{"type":"string"}}}' ),
    -- Executors
    ('apify-mcp', 'run_actor', 'Executa um ator Apify. Requer credenciais + teto de orçamento.',
     '{"type":"object","properties":{"actor_id":{"type":"string"},"input":{"type":"object"}}}',
     '{"type":"object","properties":{"run_id":{"type":"string"}}}' ),
    ('playwright-cli', 'browse_task', 'Executa tarefa de automação no navegador. Requer ambiente configurado.',
     '{"type":"object","properties":{"task":{"type":"string"},"url":{"type":"string"}}}',
     '{"type":"object","properties":{"result":{"type":"object"}}}' ),
    ('google-workspace-cli', 'workspace_action', 'Executa ação no Google Workspace. Requer OAuth configurado; escrita exige aprovação.',
     '{"type":"object","properties":{"service":{"type":"string"},"action":{"type":"string"},"params":{"type":"object"}}}',
     '{"type":"object","properties":{"result":{"type":"string"}}}')
  ) AS c(slug, name, description, input_schema, output_schema)
    ON t.slug = c.slug AND t.org_id = p_org_id
  ON CONFLICT (tool_id, name) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'seed_catalog complete for org %: catalog attached (states honest, licenses per docs/CATALOG_LICENSES.md).', p_org_id;
END;
$$;

-- seed_catalog is an administrative helper: revoke from everyone, like bootstrap.
REVOKE ALL ON FUNCTION public.seed_catalog(uuid) FROM PUBLIC, anon, authenticated;
