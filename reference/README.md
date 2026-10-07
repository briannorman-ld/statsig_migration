# Reference material

Research inputs for the build. Collected 2026-10-07. See `../PLAN.md` §1 for what we learned from each.

## statsig/
- `console-api-openapi-20240601.json`: StatSig Console API OpenAPI spec, from `https://api.statsig.com/openapi/20240601.json`. **The source of truth for Console API field names.**
- `docs-llms.txt`: index of the StatSig docs (`docs.statsig.com/llms.txt`).
- `dcs-fixtures/`: real StatSig SDK config-spec ("download_config_specs") files, taken from StatSig's open-source SDK test suites (ISC license). Use them as fixtures for the config-spec adapter.
  - `v2/`: from `statsig-io/statsig-server-core` @ `06c0055`, `statsig-rust/tests/data/`. DCS v2 format (`response_format: "dcs-v2"`, `condition_map`).
    - `eval_proj_dcs.json` (430 KB) is the richest.
    - `perf_proj_dcs.json.gz` is a large-project stress test (8.7 MB unzipped).
    - `get_id_lists.json` + `company_id_list` show the ID-list manifest and the hashed-ID file format.
    - `*.pb.br` is the protobuf+brotli form, which the app should reject with instructions.
  - `v1/`: from `statsig-io/node-js-server-sdk` @ `bda4127`, `src/__tests__/data/`. DCS v1 format (arrays of specs).
    - `rulesets_e2e_full_dcs.json` is the richest.
    - `initialize_response.json` is a *client* initialize response, which the app must reject.

## launchdarkly/
- `openapi.json`: LD REST API OpenAPI spec, from `https://app.launchdarkly.com/api/v2/openapi.json`. Marks which routes are beta.
- `semantic-patch-flags.md`, `semantic-patch-segments.md`: full semantic-patch instruction references.
- `docs/`: LD docs pages on roles, context kinds, approvals, scheduled changes, Federal, OAuth and warehouse native. Used for the capability matrix (PLAN §5.2).
- `docs-llms.txt`: index of the LD docs.

## tools/
- `python3 tools/statsig_schema_dump.py '/console/v1/gates/{id}'` prints a resolved response schema from the StatSig spec.
- `python3 tools/ld_schema_dump.py FeatureFlagBody MetricPost` prints LD schema properties.

## repos/ (gitignored; re-clone with `./fetch-repos.sh`)
- `statsig-to-ld`: launchdarkly-labs Go CLI, StatSig → LD. Prior art for the operator and condition mapping (it has known bugs; see PLAN §1) and for **metrics conversion** (`metrics convert`, `warehouse`), which is worth porting.
- `ld-migration-scripts`: launchdarkly-labs Deno tool, LD→LD + Split. Architecture patterns: fidelity ledger (`src/utils/split/mapping.ts`), rate limiter, dependency ordering, big-segment CSV import.
- `node-js-server-sdk`, `python-sdk`, `statsig-server-core`: StatSig SDKs. The **evaluator source** defines the exact DCS semantics (`node-js-server-sdk/src/Evaluator.ts`, `statsig-server-core/statsig-rust/src/evaluation/evaluator.rs`) and the hashing used by ID lists (`src/utils/Hashing.ts`).

## Facts checked live (2026-10-07), not from docs
- **LD API CORS:** `Access-Control-Allow-Origin: *` on every route we need, including PATCH/PUT/DELETE. **No `Access-Control-Expose-Headers`**, so JS can't read `X-Ratelimit-*` or `Retry-After`.
- **StatSig CORS:** the preflight succeeds, but 401 responses from `statsigapi.net` and `api.statsigcdn.com` carry **no** `Access-Control-Allow-Origin`. Whether 200 responses do is **unverified**: this is M0 spike #1 and needs a real key.
