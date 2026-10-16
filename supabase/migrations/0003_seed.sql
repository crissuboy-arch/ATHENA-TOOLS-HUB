-- ATHENA TOOLS HUB — 0003_seed.sql
-- Catalog seed with HONEST states only.
--
-- Run this in the Supabase SQL editor (as postgres / owner) AFTER the RLS
-- migration — seeding writes through the service context, which bypasses
-- RLS. It is idempotent: re-running only refreshes descriptive fields and
-- NEVER downgrades or fabricates a tool's integration state.
--
-- State rules enforced here:
--   * craft tools          -> 'in-development' (real repos exist, hub
--                             integration is not wired/tested yet)
--   * HyperFrames          -> 'cataloged'
--   * Apify MCP / Playwright CLI / Google Workspace CLI -> 'needs-config'
--                            (executors exist, credentials/config pending)
--   * NOTHING is seeded as 'connected' or 'operational-tested'.
--     A tool only reaches those states after a REAL passing test.
--
-- Licenses: repo URLs for the storytold/* craft repos are included because
-- they are the known upstream projects. `license` is NULL for every row
-- because licenses were NOT verified yet — verify before adapting any
-- third-party code (see README "License notes"). `license_verified`
-- must only become true after a human reviewed the actual LICENSE file.

DO $$
DECLARE
  v_org uuid;
BEGIN
  -- Ensure a default organization exists for the seed catalog.
  -- (The app creates real orgs via public.bootstrap_organization(); this row
  -- only guarantees the seed has an org to attach the catalog to.)
  INSERT INTO public.organizations (name, slug)
  VALUES ('Tools Hub', 'default')
  ON CONFLICT (slug) DO NOTHING;

  SELECT id INTO v_org FROM public.organizations WHERE slug = 'default';
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'seed failed: default organization not found';
  END IF;

  -- ------------------------------------------------------------------
  -- Craft tools (storytold/* upstream projects — licenses unverified)
  -- ------------------------------------------------------------------
  INSERT INTO public.tools
    (org_id, slug, name, description, category, state, license, license_verified, repo_url)
  VALUES
    (v_org, 'vectorcraft', 'VectorCraft',
     'Ferramenta de criação vetorial (projeto upstream em desenvolvimento). Integração com o Hub ainda não testada.',
     'design', 'in-development', NULL, false, 'https://github.com/storytold/vectorcraft'),
    (v_org, 'designcraft', 'DesignCraft',
     'Ferramenta de design gráfico (projeto upstream em desenvolvimento). Integração com o Hub ainda não testada.',
     'design', 'in-development', NULL, false, 'https://github.com/storytold/designcraft'),
    (v_org, 'photocraft', 'PhotoCraft',
     'Ferramenta de edição/geração de fotos (projeto upstream em desenvolvimento). Integração com o Hub ainda não testada.',
     'design', 'in-development', NULL, false, 'https://github.com/storytold/photocraft'),
    (v_org, 'lightcraft', 'LightCraft',
     'Ferramenta de iluminação/edição fotográfica (projeto upstream em desenvolvimento). Integração com o Hub ainda não testada.',
     'design', 'in-development', NULL, false, 'https://github.com/storytold/lightcraft'),
    (v_org, 'artcraft', 'ArtCraft',
     'Ferramenta de geração de arte (projeto upstream em desenvolvimento). Integração com o Hub ainda não testada.',
     'design', 'in-development', NULL, false, 'https://github.com/storytold/artcraft'),
    (v_org, 'wordcraft', 'WordCraft',
     'Ferramenta de escrita/conteúdo textual (projeto upstream em desenvolvimento). Integração com o Hub ainda não testada.',
     'content', 'in-development', NULL, false, 'https://github.com/storytold/wordcraft')
  ON CONFLICT (org_id, slug) DO UPDATE SET
    name            = EXCLUDED.name,
    description     = EXCLUDED.description,
    category        = EXCLUDED.category,
    license         = EXCLUDED.license,
    license_verified = EXCLUDED.license_verified,
    repo_url        = EXCLUDED.repo_url,
    updated_at      = now();
  -- NOTE: `state` is deliberately NOT overwritten on conflict. The seed never
  -- demotes a tool (e.g. back to 'in-development') after a real test.

  -- ------------------------------------------------------------------
  -- HyperFrames (video frame engine from the MKVideos lineage — cataloged)
  -- ------------------------------------------------------------------
  INSERT INTO public.tools
    (org_id, slug, name, description, category, state, license, license_verified, repo_url)
  VALUES
    (v_org, 'hyperframes', 'HyperFrames',
     'Motor de quadros/vídeo (linhagem MKVideos). Apenas catalogado — nenhuma integração real testada ainda.',
     'video', 'cataloged', NULL, false, NULL)
  ON CONFLICT (org_id, slug) DO UPDATE SET
    name            = EXCLUDED.name,
    description     = EXCLUDED.description,
    category        = EXCLUDED.category,
    license         = EXCLUDED.license,
    license_verified = EXCLUDED.license_verified,
    repo_url        = EXCLUDED.repo_url,
    updated_at      = now();

  -- ------------------------------------------------------------------
  -- Executors (need credentials/config before any real run)
  -- ------------------------------------------------------------------
  INSERT INTO public.tools
    (org_id, slug, name, description, category, state, license, license_verified, repo_url)
  VALUES
    (v_org, 'apify-mcp', 'Apify MCP',
     'Executor de atores Apify via MCP. Requer credenciais Apify configuradas antes de qualquer execução real.',
     'automation', 'needs-config', NULL, false, 'https://github.com/apify'),
    (v_org, 'playwright-cli', 'Playwright CLI',
     'Automação de navegador via Playwright CLI. Requer ambiente/configuração antes de qualquer execução real.',
     'automation', 'needs-config', NULL, false, 'https://github.com/microsoft/playwright'),
    (v_org, 'google-workspace-cli', 'Google Workspace CLI',
     'Integração com Google Workspace via CLI. Requer OAuth/credenciais configuradas antes de qualquer uso real.',
     'automation', 'needs-config', NULL, false, NULL)
  ON CONFLICT (org_id, slug) DO UPDATE SET
    name            = EXCLUDED.name,
    description     = EXCLUDED.description,
    category        = EXCLUDED.category,
    license         = EXCLUDED.license,
    license_verified = EXCLUDED.license_verified,
    repo_url        = EXCLUDED.repo_url,
    updated_at      = now();

  -- ------------------------------------------------------------------
  -- Declared capabilities (contracts only — NOT proof of execution)
  -- ------------------------------------------------------------------
  INSERT INTO public.tool_capabilities (org_id, tool_id, name, description, input_schema, output_schema)
  SELECT v_org, t.id, c.name, c.description,
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
    ('artcraft', 'generate_art', 'Gera arte a partir de prompt. Integração real ainda não testada.',
     '{"type":"object","properties":{"prompt":{"type":"string"}}}',
     '{"type":"object","properties":{"file_path":{"type":"string"}}}' ),
    ('wordcraft', 'generate_copy', 'Gera texto/copy a partir de brief. Integração real ainda não testada.',
     '{"type":"object","properties":{"brief":{"type":"string"},"language":{"type":"string"}}}',
     '{"type":"object","properties":{"text":{"type":"string"}}}' ),
    -- HyperFrames
    ('hyperframes', 'render_frames', 'Renderiza sequência de quadros para vídeo. Não testado de ponta a ponta.',
     '{"type":"object","properties":{"scene":{"type":"object"}}}',
     '{"type":"object","properties":{"frames_path":{"type":"string"}}}' ),
    -- Executors
    ('apify-mcp', 'run_actor', 'Executa um ator Apify. Requer credenciais Apify.',
     '{"type":"object","properties":{"actor_id":{"type":"string"},"input":{"type":"object"}}}',
     '{"type":"object","properties":{"run_id":{"type":"string"}}}' ),
    ('playwright-cli', 'browse_task', 'Executa tarefa de automação no navegador. Requer ambiente configurado.',
     '{"type":"object","properties":{"task":{"type":"string"},"url":{"type":"string"}}}',
     '{"type":"object","properties":{"result":{"type":"object"}}}' ),
    ('google-workspace-cli', 'workspace_action', 'Executa ação no Google Workspace. Requer OAuth configurado.',
     '{"type":"object","properties":{"service":{"type":"string"},"action":{"type":"string"},"params":{"type":"object"}}}',
     '{"type":"object","properties":{"result":{"type":"object"}}}' )
  ) AS c(slug, name, description, input_schema, output_schema)
    ON t.slug = c.slug AND t.org_id = v_org
  ON CONFLICT (tool_id, name) DO NOTHING;

  RAISE NOTICE 'Seed complete: catalog attached to org % (slug=default). States are honest; licenses unverified.', v_org;
END $$;
