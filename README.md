# ATHENA TOOLS HUB

Professional platform for AI tools, automation, content creation, design,
video, documents, research and reverse engineering — built to be commanded
by ATHENA Control in the future.

> **Status:** MVP foundation in progress (`feat/mvp-foundation`).
> Independent project. It does NOT modify ATHENA Control, CRIS OS, Hermes,
> TrendHub USA, PageForge AI, or any other existing product.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4
- Supabase Auth + PostgreSQL + RLS (migrations only — no project connected yet)
- Versioned APIs under `/api/v1`
- PWA-ready, responsive (desktop + iPhone/iPad)
- UI in Portuguese (pt-BR), structured for future i18n

## Getting started

```bash
cp .env.example .env.local   # fill in when a dedicated Supabase project exists
npm install
npm run dev
```

Useful scripts:

| Script             | What it does                    |
| ------------------ | ------------------------------- |
| `npm run dev`      | Development server (Turbopack)  |
| `npm run build`    | Production build                |
| `npm run typecheck`| TypeScript check                |
| `npm run lint`     | ESLint                          |
| `npm test`         | Unit tests (vitest)             |

## Project structure

```
app/
  (app)/            # authenticated app shell (sidebar layout)
    page.tsx        # dashboard
    catalog/        # tool catalog + per-tool pages
    jobs/           # executions
    approvals/      # approvals
    results/        # generated assets
    integrations/   # service integrations
    reverse-engineering/
    settings/
  api/v1/           # versioned HTTP API (+ Athena machine contract)
components/ui/      # reusable accessible primitives
lib/
  catalog/          # tool registry (honest states, licenses)
  jobs/             # job state machine, idempotency
  adapters/         # tool contracts + adapters (VectorCraft first)
  supabase.ts       # Supabase clients (env-gated)
supabase/
  migrations/       # versioned SQL migrations + RLS
  seed.sql          # catalog seed (honest integration states)
docs/
  SUPABASE_SETUP.md
  ATHENA_INTEGRATION.md
  API.md
openapi.yaml        # Athena machine contract
```

## Design

Dark navy `#0A1A33`, white, elegant gold `#C6A15B`, dark gray.
No purple, no orange as primary colors. See `app/globals.css`.

## Tool states (honest, always)

`cataloged` → `needs-config` → `in-development` → `connected` →
`operational-tested` → `error` / `unavailable`

A tool is **never** marked operational without a real passing test.
No simulations presented as real executions.

## Pending owner decisions

- Confirm whether a **dedicated Supabase project** for Tools Hub exists.
  Never reuse another product's database without proper isolation and
  explicit authorization.
- Real Athena linkage happens later, together with Cláudio, after the
  multi-agent architecture is complete.

## License notes

Catalog tools based on third-party open-source repos document their
license per tool (see `lib/catalog/` and `docs/`). Licenses are respected
in full; no code is adapted before its license is verified.
