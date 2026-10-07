# TODO — M0 spike #1: can a browser read StatSig responses? (PLAN §3.1)

**Status: not done.** Skipped in the M0/M1 session because no StatSig Console key was available.
Everything else in the app works without it (demo mode, spec upload). This spike decides whether
the one allowed server component — a stateless relay — has to exist. **Ask before building it.**

## What we already know (checked 2026-10-07, no key)
- `statsigapi.net` preflight succeeds and allows the `STATSIG-API-KEY` header.
- 401 responses from `statsigapi.net` and `api.statsigcdn.com` carry **no** `Access-Control-Allow-Origin`.
  So in a browser a bad key looks like a network error. The app already handles this
  (`StatsigUnreachableError`: "StatSig unreachable, the key may be invalid", after AIMD backoff).

## What to check (needs a real, read-only Console key and a spec-scoped client key)
1. **Console API 200 responses** carry `Access-Control-Allow-Origin` (either `*` or the app origin):
   ```bash
   curl -s -D - -o /dev/null -H "Origin: http://localhost:5173" \
     -H "STATSIG-API-KEY: $STATSIG_CONSOLE_KEY" -H "STATSIG-API-VERSION: 20240601" \
     https://statsigapi.net/console/v1/project | grep -i '^access-control'
   ```
2. **429 responses**: same check on a throttled response (burst ~20 requests). Expect no CORS header.
3. **Spec CDN 200 responses**:
   ```bash
   curl -s -D - -o /dev/null -H "Origin: http://localhost:5173" \
     "https://api.statsigcdn.com/v2/download_config_specs/$STATSIG_CLIENT_KEY.json" | grep -i '^access-control'
   ```
4. **In the real browser** (curl can't prove it): run the app (`pnpm dev`), open DevTools on the app tab
   and paste — the CSP already allows these hosts:
   ```js
   const r = await fetch('https://statsigapi.net/console/v1/project', { headers: { 'STATSIG-API-KEY': '<key>', 'STATSIG-API-VERSION': '20240601' } });
   console.log(r.status, (await r.json()).data);
   ```
   Then *Add source → Console API key* in the UI and confirm a full crawl completes.
5. While a real key is at hand, turn on **capture-fixture mode** (`StatsigConsoleClient({ capture })`) to
   record real responses, and diff them against `packages/demo-fixtures` shapes. Log any
   `schema_mismatch` warnings (Source warnings view) as fixture/schema fixes.

## Decision
| Result | Action |
|---|---|
| 200s readable from the browser | Done: no relay. Keep the opaque-error handling for 401/429. Enable **Fetch spec** in the UI if the CDN also allows it. |
| 200s blocked | Propose the stateless relay (PLAN §3.1): one Vercel Edge Function forwarding GETs to `statsigapi.net`, no storage, no header/body logging, open source. Add its origin to `CONNECT_HOSTS` in `apps/web/csp.ts`. **Ask the user before building it.** |
| CDN blocked, API OK | Hide **Fetch spec**; file upload covers spec-only sources. |

Code hooks waiting on this spike: `apps/web/csp.ts` (TODO), `apps/web/src/screens/AddSource.tsx` (warning
callout), `packages/adapters/src/spec/parse.ts` (Fetch spec not exposed in the UI yet).
