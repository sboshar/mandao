# Mandao

A Mandarin sentence-based SRS study app — install once, learn from sentences, sync across devices.

Built around the idea that vocabulary is best learned in context. You add sentences, the app extracts words, characters, and pinyin from them, and a spaced-repetition scheduler decides what to review when. Audio, AI-assisted analysis, an Anki import path, and a force-directed graph view round it out.

## Stack

- **React 19** + **TypeScript** + **Vite 8** + **Tailwind v4**
- **ts-fsrs** — Free Spaced Repetition Scheduler for review scheduling
- **Dexie** (IndexedDB) — local-first storage
- **Supabase** — auth + outbox-based sync between devices
- **vite-plugin-pwa** — installable, offline-capable PWA
- **react-force-graph-2d** — graph view of words/characters/sentences/pinyin relationships
- **pinyin-pro** + custom tone-sandhi pipeline — numeric ↔ diacritic, tone changes
- **CC-CEDICT** — bundled dictionary for definitions
- **Vitest** — tests

## Running locally

```bash
npm install
npm run dev          # vite dev server (PWA enabled in dev)
npm run build        # tsc -b && vite build
npm test             # vitest run
npm run lint
```

Supabase config is read from Vite env vars at build time. Copy `.env.example` (if present) or set:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

The app works fully offline without these — sync just no-ops.

## Architecture sketch

- `src/db/` — Dexie schema, repos, and the outbox-based sync engine. Writes go to a local outbox table; the sync engine drains it to Supabase and pulls remote changes back.
- `src/services/` — domain logic (ingestion of new sentences, pinyin/sandhi, AI providers, Anki import/export, audio).
- `src/stores/` — Zustand stores for UI state (theme, navigation, AI/FSRS settings, sync status).
- `src/pages/` — top-level routes (Dashboard, Study, Graph, Settings, …).
- `src/components/` — shared UI (MeaningCard, ThemeToggle, etc.).
- `src/lib/` — small utilities (PWA registration, audio storage, dictionary lookup, …).

## PWA / auto-update

The service worker is registered via `src/lib/pwaUpdate.ts`. On top of vite-plugin-pwa's `autoUpdate` mode, it re-checks for a new SW on `visibilitychange`, on `focus`, and once an hour, then auto-reloads on `controllerchange`. This means an installed PWA picks up new Vercel deploys on resume from background — no manual quit-and-relaunch needed.

The very first time the app installs SW updates after this code lands, the user's existing SW must be replaced via a normal page reload (browser tab) or a cold start (installed PWA). After that, updates land automatically.

## Deployment

Deployed to Vercel from `main`. SPA fallback rewrite is in `vercel.json`. Pushes to `main` are gated by branch protection — work on a feature branch and open a PR.

## Tests

```bash
npm test               # run once
npm run test:watch     # watch mode
```

Test files live alongside the code they cover (`*.test.ts`). The suite uses `fake-indexeddb` so Dexie-backed code can run under Vitest.
