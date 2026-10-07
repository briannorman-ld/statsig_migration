# StatSig → LaunchDarkly Migration Console

A browser-only app (static Vite SPA, no backend) that reads StatSig projects and compares them
with one LaunchDarkly project. The spec is [PLAN.md](PLAN.md); project rules are in
[CLAUDE.md](CLAUDE.md). Status: **M0 + M1** (foundations, source adapters, canonical model, demo
dataset, LD connect + capability probe, a minimal UI shell). M0 spike #1 is still open:
[docs/TODO-m0-spike-1-statsig-cors.md](docs/TODO-m0-spike-1-statsig-cors.md).

## Run
Requires Node ≥ 22.13 (`nvm use`) and pnpm 11.

```bash
pnpm install
pnpm dev            # http://localhost:5173 — click "Try the demo"
pnpm test           # all unit tests (Vitest)
pnpm typecheck
pnpm build          # static site in apps/web/dist (strict CSP <meta>; vercel.json sends headers)
pnpm test:live      # read-only checks against real LD; needs LD_API_TOKEN in .env.local
pnpm fixtures:generate   # regenerate the committed demo dataset + sample spec files
```

## Layout
| Path | What |
|---|---|
| `apps/web` | React + Vite SPA. Pipeline Web Worker (`src/pipeline`), in-memory token vault (`src/lib/secrets.ts`), CSP (`csp.ts`). |
| `packages/http` | Shared transport: AIMD concurrency limiter, sliding-window rate budgets, jittered retries, opaque-failure handling. |
| `packages/canonical` | Source-agnostic model (PLAN §4), per-environment rule resolution, effective-targeting fingerprints, snapshot diff, cross-source matching. |
| `packages/statsig-client` | Console API client: pagination, odd shapes, lenient Zod schemas, capture hook. |
| `packages/adapters` | Console API crawl + normalize; config-spec (DCS v1/v2) parse + normalize. |
| `packages/ld-client` | LD REST client (read-only so far) + capability probe (PLAN §5.2). |
| `packages/store` | Dexie/IndexedDB workspace store; refuses token-like fields. |
| `packages/demo-fixtures` | "Acme Retail" dataset (PLAN §19), MSW mock of the Console API, config-spec generator, sample files. |
| `packages/mapper`, `packages/planner` | M3 (contracts only). |
