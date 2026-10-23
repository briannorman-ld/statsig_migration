# Migrating from StatSig to LaunchDarkly: what moves, what needs a decision, and what doesn't exist on the other side

*Working notes for the migration console and the source material for a blog post. The tables under "Coverage matrix" are generated from `packages/coverage/src/matrix.ts` (`pnpm coverage:generate`) and are the same data the console shows on its **What migrates** page. Row-level detail lives in [KNOWN-EDGE-CASES.md](KNOWN-EDGE-CASES.md). Last reviewed 2026-10-22 against the StatSig docs, the StatSig Console API spec (20240601), the StatSig SDK evaluator source, the LaunchDarkly docs and the LaunchDarkly REST API spec (20240415).*

## TL;DR

- **Feature gates, dynamic configs, segments and Autotune migrate automatically**, per environment, with every inexact translation surfaced as a Decision you answer once. Nothing is dropped or approximated silently.
- **Experiments, layers and holdouts don't move mid-flight.** Running experiments finish in StatSig; their structure (flags, metrics, layers, holdouts) is carried over so new experiments start in LaunchDarkly. The console inventories them today and writes drafts in a later milestone.
- **Metrics translate; events don't.** Metric definitions can be converted, but the events behind them must be re-sent through the LaunchDarkly SDK. The console produces the instrumentation checklist.
- **Some things have no LaunchDarkly equivalent**: contextual bandits, composite metrics, switchback experiments, JSON-schema validation of config values, StatSig's product analytics, session replay and dashboards. They are listed, not hidden.
- **StatSig has no "all projects" API.** A Console API key belongs to one project, so the console reads one project per source and can consolidate several sources into one LaunchDarkly project.

## 1. The two platforms are organized differently

| | StatSig | LaunchDarkly |
|---|---|---|
| Top level | Organization (company) | Account |
| Unit of configuration | **Project**: gates, configs, experiments, segments, metrics live here | **Project**: flags, segments, metrics, experiments live here |
| Environments | Tiers (`development`, `staging`, `production`, custom). Rules are project-wide and may be *scoped* to tiers | Environments. **Targeting is per environment**; a flag exists in every environment |
| Identity | Unit ID types: `userID`, `stableID`, custom IDs | Context kinds: `user` built in, any other kind created per project |
| Segments | Project-wide | **Per environment** |
| API access | Console API key, **scoped to one project** | Service token, scoped by role; can see every project |
| SDK key scoping | By environment and by **target app** | By environment; flags opt in to client-side SDKs |

Three consequences for a migration:

1. **One Console key reads one project.** There is no Console API call that lists an organization's projects, so a tool cannot "pull in all projects". The console asks for a key per project (a *source*) and lets a workspace hold several sources that write into one LaunchDarkly project. Gates with the same name and identical targeting across sources merge into one flag; different targeting gets prefixed keys.
2. **Environment scoping becomes per-environment targeting.** A StatSig rule enabled only in `staging` is dropped from `production` with a note. `environment_tier` conditions are resolved statically. Creating a flag creates it in every LaunchDarkly environment, off; environments you have not migrated show as *not migrated* and keep serving StatSig.
3. **Target apps have no counterpart.** They scope StatSig SDK keys, nothing more. In LaunchDarkly each flag decides whether client-side and mobile SDKs may read it, so every migrated flag asks this once (a policy answers it for all).

## 2. What migrates automatically

Gates become boolean flags, dynamic configs become JSON multivariate flags, segments become per-environment segments and Autotune becomes a drafted multi-armed bandit. The mapper is pure and deterministic: the same StatSig snapshot, mapping profile and answers always produce the same LaunchDarkly state, and golden tests pin what lands in a customer's project.

What carries over exactly:

- **Rule order and first-match semantics.** Both platforms evaluate rules top-down and stop at the first rule whose conditions match.
- **Pass percentages.** Verified in the StatSig SDK evaluator (`_evalConfig`): a user who matches a rule but falls outside its pass percentage gets *fail* (gates) or the *default value* (configs); evaluation does **not** continue to the next rule. That is exactly an LD rule serving a percentage rollout between the rule's variation and the fail/default variation.
- **Overrides** become individual targets per context kind, scoped to the environment they apply to.
- **Gate references** (`passes_gate` / `fails_gate`) are inlined when the referenced gate has only 100% rules, or become an LD prerequisite when every rule requires the same gate.
- **Names, descriptions, tags, lifecycle** (`PERMANENT` → permanent flag, everything else temporary; stale gates get a "hard-code me" note), and **provenance**: `statsig-migrated` / `statsig-src-<alias>` tags, `statsig.*` custom properties and an audit comment naming the StatSig version and the run.

## 3. What needs a decision, and why

The two platforms disagree on a handful of evaluation details. Each one becomes a **Decision** with a recommended option, answered once per item or once per workspace as a policy. These are the ones customers hit most:

| Difference | StatSig | LaunchDarkly | Decision |
|---|---|---|---|
| Case | `any`, `str_contains_any`, `str_starts_with_any`, … lower-case both sides | All string operators are case-sensitive; no case-insensitive variants exist | `case_insensitive_match`: case-folded regex (exact), lower/upper variants, or exact |
| Types | `any [2, 3]` matches `2` and `"2"`; comparisons coerce numeric strings | `in` compares typed values: `"2" ≠ 2` | `value_type`: emit both forms, numbers only, or strings only |
| Missing attributes | `none`, `neq`, `str_contains_none` **pass** when the attribute is absent | A clause on a missing attribute never matches, negated or not | `negated_missing_attribute` (acknowledge) |
| Null checks | `is_null` / `is_not_null` | No "is set" operator | `null_check`: `is_not_null` ≈ `matches ".*"`; `is_null` must drop the rule or skip |
| Versions | Any number of parts, suffix after `-` stripped, missing parts padded | Strict semver; 4-part strings never match; `1.0.0-beta < 1.0.0` | `version_format`: truncate, drop, or skip |
| Regex | JavaScript `RegExp` | Each SDK's engine; no lookbehind/lookahead anywhere | `regex_dialect` when non-portable constructs are found |
| Derived attributes | Browser, OS, device model parsed from the user agent; country from IP | SDKs never derive attributes | `derived_attribute`: the app must send the attribute (goes into the context contract) |
| Time | `time` conditions read the SDK clock | No clause can read the clock | Past windows resolve statically; future ones are `time_condition` (scheduled change) |
| Bucketing | `sha256(salt.ruleSalt.unitID)` | `sha1(flagKey.salt.key)` | `partial_rollout_rebucket`: same percentage, different users; acknowledged per rule |
| Prerequisite order | Overrides are evaluated before rules | Prerequisites are evaluated **before** individual targets | Reported as partial fidelity when a prerequisite flag also has pass overrides |
| Holdouts on gates | Hold out N% before the rules | A separate holdout population (a prerequisite flag under the hood) | `holdout_attached` (acknowledge) until LD holdouts are created |
| No equivalent clause | `target_app`, `url`, `javascript`, `experiment_group` | — | `unsupported_condition`: drop condition, drop rule, or skip |

Two more differences are handled without a decision but worth knowing:

- **Segment rules with percentages fall through in LaunchDarkly.** In StatSig a segment is evaluated like a gate: the first matching rule decides, and users outside its pass percentage *fail*. In LaunchDarkly a context that misses a segment rule's percentage **continues to the next segment rule**. For a segment with one weighted rule the result is identical; with several rules it is not, and the console notes it.
- **Rollouts and context kinds.** If LaunchDarkly evaluates a rollout keyed on a context kind the evaluated context does not have, it serves the first variation with weight > 0 rather than the off variation. Multi-context requirements are listed in the generated context contract so SDK calls send every kind a flag needs.

## 4. What has no LaunchDarkly equivalent

These are the genuine limitations. The console lists each affected item so nobody discovers them after cutover.

- **Contextual bandits (Autotune AI).** LaunchDarkly bandits are plain Thompson-sampling bandits; there is no per-context policy. Use a bandit, or an experiment per segment.
- **Composite and user-accounting metrics** (DAU/WAU/retention, metrics built from other metrics). Rebuild from the underlying events, or as a metric group.
- **Switchback experiments**, and StatSig-specific analysis options. LaunchDarkly offers Bayesian and frequentist (fixed-horizon and sequential) analysis, CUPED and stratified sampling, configured per experiment.
- **JSON-schema validation of dynamic config values.** JSON variations are free-form; the schema is kept in the flag description.
- **Per-parameter config reads.** `getConfig("x").get("p", default)` becomes one `jsonVariation("x", default)` and a field read; StatSig never merged rule values with the default either, so behaviour is unchanged.
- **Experiment results and exposures.** Results stay in StatSig (archived to a file and linked from the flag). LaunchDarkly cannot import a finished experiment's data or a finished bandit's learning.
- **Product analytics, web analytics, session replay, dashboards, alerts, reports.** LaunchDarkly Observability is a different product with its own instrumentation.
- **Release pipelines, review settings, integrations, keys, users and roles.** Organizational configuration is set up directly in LaunchDarkly.
- **Config-spec-only sources** cannot provide metrics or raw ID-list members (StatSig ships large lists as one-way hashes); a Console API key or a raw-ID CSV fills the gap.

## 5. Experiments: why nothing moves mid-flight

Re-randomizing a running experiment invalidates its results: StatSig and LaunchDarkly bucket differently, so the same user would land in a different group. The console therefore treats experiment state as the deciding factor:

| StatSig state | What the console does |
|---|---|
| `setup` (not started) | JSON flag (a variation per group) and a **draft** LaunchDarkly experiment with the hypothesis, treatments, allocation, randomization unit and metrics |
| `active` | "Running in StatSig, migrate after it ends." Optionally pre-stage the draft |
| `decision_made` / shipped | Flag serving the shipped group at 100%; results archived |
| `abandoned` / `archived` | Skipped, listed for completeness |

Layers become LaunchDarkly layers (which reserve traffic for whole experiments, not for shared parameters, so code using `getLayer().get()` gets a `layer_parameters` decision). Holdouts become new populations with the same percentage. Metrics are the critical path: a new LaunchDarkly experiment needs its metrics first, and LaunchDarkly's own warehouse-native path (Snowflake, BigQuery, Databricks, Redshift, ClickHouse) needs a data source created by an LD admin in the UI before any metric can be written through the API.

## 6. Things LaunchDarkly has that StatSig customers should adopt on the way in

A migration is a chance to pick up capabilities that have no StatSig counterpart, or a stronger one:

- **Context kinds and multi-contexts** replace custom unit IDs with first-class kinds that can target, roll out and experiment on `company`, `device`, `organization` and more, together in one evaluation.
- **Guarded rollouts** (Release Guardian) monitor metrics during a rollout and roll back automatically, the natural home for StatSig safeguards once metrics exist in LD. **Progressive rollouts** schedule percentage steps over time.
- **Approvals, scheduled changes and custom roles** give production change control; the console will file an approval request instead of writing directly where an environment requires it.
- **Flag views** group flags, segments and configs for access scoping; projects can require every flag to belong to one.
- **Code references** (`ld-find-code-refs`) find every call site because migrated keys equal StatSig names.
- **Migration flags**, **AgentControl** (AI configs), **Observability** and **Vega** are separate LaunchDarkly products available after the move.

## 7. Prior art and why this console exists

LaunchDarkly's built-in flag importer supports Split and Unleash and copies flag shells only (name, key, variations, tags; flags land off with no rules or targets). The earlier `statsig-to-ld` CLI mapped rules but had known operator bugs, no decision model, and no per-environment state. This console is browser-only, writes only to LaunchDarkly, records the migration ledger in the LD project itself (tags, custom properties, audit comments) and treats every imperfect mapping as a decision a person answers.

## Coverage matrix

<!-- coverage:start (generated by pnpm coverage:generate; edit packages/coverage/src/matrix.ts) -->

### Legend

| Mark | Status | Meaning | Rows |
|---|---|---|---|
| ✅ | **Migrates** | Translated exactly and written automatically; at most an informational note. | 8 |
| 🟡 | **Migrates with decisions** | Written automatically once you answer a Decision or acknowledge a documented difference. Nothing is dropped silently. | 24 |
| 🧭 | **Guided / manual** | The console does not write it; it produces a checklist, a generated document or step-by-step guidance and a person finishes it in LD or in code. | 10 |
| 🚧 | **Planned** | LD has an equivalent and the mapping is specified, but the console does not write it yet. The item is inventoried and its blockers are listed. | 13 |
| ❌ | **No LD equivalent** | LaunchDarkly has no equivalent, or it is a different product that is set up on its own. | 12 |

### Projects, environments and identity

StatSig organizes an organization into projects; a Console API key belongs to exactly one project, so the console reads one project per source and can consolidate several sources into one LaunchDarkly project.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🧭 | Organization (company) with several projects | Account with several projects | One workspace targets one LD project; add a source per StatSig project you want in it, or create one workspace per StatSig project. | StatSig has no Console API call that lists the projects of an organization, and a Console API key is scoped to one project, so the console cannot discover your projects: you add each project with its own key. Several sources in one workspace are consolidated (same name and identical targeting → one flag; different targeting → prefixed keys). [StatSig](https://docs.statsig.com/console-api/introduction) · [LD](https://launchdarkly.com/docs/home/account/project) |
| 🟡 | Environments (tiers: development, staging, production, custom) | Environments | Each StatSig environment maps to an LD environment, or to "not migrated"; LD environments can be created from the mapping page. | Rules scoped to an unmapped tier are dropped from the mapped environments, with a note. Migration state is tracked per (resource, LD environment). Edge cases: 2.1, 2.2, 2.5. [StatSig](https://docs.statsig.com/guides/using-environments) · [LD](https://launchdarkly.com/docs/home/account/environment) |
| 🟡 | Unit ID types (userID, stableID, custom IDs) | Context kinds | userID → user, stableID → device, a custom unit type → a context kind of the same name, created on first use. | Custom unit IDs are never collapsed into user. A unit type that has no context kind in LD yet raises a unit_type_kind decision (name it, or pick an existing kind). Decisions: `unit_type_kind`. Edge cases: 3.1, 3.2, 3.4, 3.5. [StatSig](https://docs.statsig.com/guides/experiment-on-custom-id-types) · [LD](https://launchdarkly.com/docs/home/observability/contexts) |
| 🟡 | Target apps | Client-side availability per flag (+ tags) | Target apps only scope StatSig keys, so each flag asks which LD SDK types may see it (client, mobile, server). | Decisions: `client_side_availability`. Edge cases: 1.7. [StatSig](https://docs.statsig.com/sdks/target-apps) · [LD](https://launchdarkly.com/docs/sdk/concepts/client-side-server-side) |
| 🟡 | Tags, owners, teams | Tags, maintainer, team | Tags are copied (sanitized to LD’s format); the owner is kept as a custom property. | The LD maintainer must be an account member, so owners are not assigned automatically yet; statsig.owner carries the email. Teams are not mapped. Edge cases: 1.4, 1.5. [LD](https://launchdarkly.com/docs/home/flags/custom-properties) |
| ❌ | Console API keys, server/client SDK keys | Service tokens, SDK keys | Keys are never migrated; the console uses a read-only Console key and an LD service token, both kept in memory only. | Each app re-initializes its SDK with an LD key for the right environment. Spec-only sources can be read with a client key that only downloads the config spec. [StatSig](https://docs.statsig.com/sdk-keys/api-keys) · [LD](https://launchdarkly.com/docs/home/account/api) |
| ❌ | Users, roles, SSO/SCIM | Members, roles, SSO/SCIM | Account administration is set up in LD directly; the console only reads StatSig users to resolve owner names. | [StatSig](https://docs.statsig.com/access-management/introduction) · [LD](https://launchdarkly.com/docs/home/account/members) |

### Feature gates

Gates become boolean flags with per-environment targeting, individual targets and prerequisites.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🟡 | Feature gate (rules, pass percentages, on/off) | Boolean flag with per-environment targeting | Each rule becomes an LD rule; a pass percentage becomes a percentage rollout; disabled gates are off; the shell carries name, description, tags, temporary and StatSig provenance. | The first StatSig rule whose conditions match ends evaluation, and users outside its pass percentage fail (no fall-through), which is exactly how an LD rule with a rollout behaves. Partial rollouts re-bucket users because the two platforms hash differently; this is acknowledged once per rule. Decisions: `partial_rollout_rebucket`, `rule_expansion`, `client_side_availability`. Edge cases: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.10, 4.11. [StatSig](https://docs.statsig.com/feature-flags/working-with) · [LD](https://launchdarkly.com/docs/home/flags/targeting) |
| ✅ | Overrides (user IDs, custom IDs, per environment) | Individual targets per context kind | Pass/fail overrides become individual targets on the matching variation, scoped to the environment they apply to. | An ID overridden both ways keeps the environment-specific (or first) override, and the conflict count is reported. Edge cases: 8.1, 8.2, 8.3, 8.4. [StatSig](https://docs.statsig.com/feature-flags/overrides) · [LD](https://launchdarkly.com/docs/home/flags/individual-targeting) |
| 🟡 | Rules that check another gate (passes_gate / fails_gate) | Inlined rules, or a prerequisite flag | A referenced gate with only 100% rules is inlined exactly; a gate every rule requires becomes an LD prerequisite (Enterprise); anything else is a gate_reference decision. | LD evaluates prerequisites before individual targets, so overrides on the referring gate stop applying to users who fail the prerequisite; this is reported as partial fidelity. Decisions: `gate_reference`. Edge cases: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9. [LD](https://launchdarkly.com/docs/home/flags/prerequisites) |
| 🟡 | Holdout attached to a gate | LD holdout (separate population) | The held-out share is acknowledged per gate (holdout_attached); LD holdouts are not created yet, so held-out users receive the feature in LD. | Decisions: `holdout_attached`. Edge cases: 4.8. [StatSig](https://docs.statsig.com/holdouts) · [LD](https://launchdarkly.com/docs/home/holdouts) |
| ✅ | Gate type and status (PERMANENT / TEMPORARY / STALE, Launched / Disabled) | temporary flag, on/off, flag status | PERMANENT → temporary: false, anything else → true; stale gates get a "consider hard-coding" note; Launched gates are on and serve true to everyone. | Edge cases: 1.6, 4.4. [StatSig](https://docs.statsig.com/feature-flags/permanent-and-stale-gates) · [LD](https://launchdarkly.com/docs/home/flags/flag-status) |
| ❌ | Gate measurement (Pulse on a gate), diagnostics, exposure counts | Flag insights, experiments on a flag | Historical gate measurements stay in StatSig; LD starts measuring once traffic arrives. | Check counts and exposure counts from StatSig are used by the console for readiness and cutover reporting, not written to LD. [StatSig](https://docs.statsig.com/feature-flags/view-exposures) · [LD](https://launchdarkly.com/docs/home/flags/flag-insights) |
| 🧭 | Safeguards / monitored (metric-guarded) rollouts, scheduled rollouts | Guarded rollouts, progressive rollouts, scheduled flag changes | Reported per gate; configured in LD by hand because the guardrail metrics have to exist in LD first. | Metric-based safeguards map naturally to LD guarded rollouts once the metrics are migrated; the console lists which gates carry them. [StatSig](https://docs.statsig.com/feature-flags/safeguards) · [LD](https://launchdarkly.com/docs/home/releases/guarded-rollouts) |
| 🚧 | Change reviews, pre-commit webhooks, change validation | Approval requests, workflows, custom roles | Environments that require approvals in LD will receive an approval request instead of a direct write; StatSig review settings themselves are not copied. | [StatSig](https://docs.statsig.com/guides/change-management) · [LD](https://launchdarkly.com/docs/home/releases/approvals) |
| ❌ | Release pipelines | Release pipelines | Pipelines are organizational policy, not targeting; set them up in LD and attach migrated flags there. | [StatSig](https://docs.statsig.com/feature-flags/release-pipelines) · [LD](https://launchdarkly.com/docs/home/releases/release-pipelines) |

### Dynamic configs

Dynamic configs become JSON multivariate flags: the default value plus one variation per distinct rule value.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🟡 | Dynamic config (default value + per-rule return values) | JSON multivariate flag | The default value is variation 0; each distinct rule value becomes a variation; rules target their variation and partial rollouts split between the rule value and the default. | Verified against the StatSig SDK evaluator: a user who matches a rule but falls outside its pass percentage gets the default value, not the next rule. Variations are append-only: a new value seen after one environment was migrated is appended, never reordered. Decisions: `partial_rollout_rebucket`, `key_collision`. Edge cases: 10.1, 10.2, 10.4, 10.6, 10.8. [StatSig](https://docs.statsig.com/dynamic-config) · [LD](https://launchdarkly.com/docs/home/flags/variations) |
| 🟡 | Rule variants (several values split by percentage inside one rule) | Percentage rollout across variations | Each variant becomes a variation; the rule serves a rollout with the variant weights (re-bucketed). | Decisions: `partial_rollout_rebucket`. Edge cases: 10.3. |
| ❌ | JSON schema validation of config values | — | LD does not validate JSON variations against a schema; the schema is noted and kept in the description. | Edge cases: 10.5. |
| 🧭 | Per-parameter reads: getConfig("x").get("p", default) | jsonVariation("x", default) returns the whole object | A code-change note: read the object once and pick fields; StatSig does not merge rule values with the default either. | Edge cases: 10.7. [LD](https://launchdarkly.com/docs/sdk/features/evaluating) |

### Segments

Project-wide StatSig segments become one LaunchDarkly segment per migrated environment.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🟡 | Rule-based segment | Segment with rules (one per migrated environment) | Rules translate like gate rules; a pass percentage becomes a weighted segment rule; a gate reference inside a segment is inlined when exact, otherwise the segment is skipped. | Decisions: `partial_rollout_rebucket`, `case_insensitive_match`. Edge cases: 9.1, 9.6, 9.7, 9.8, 9.9. [StatSig](https://docs.statsig.com/segments) · [LD](https://launchdarkly.com/docs/home/flags/segments) |
| ✅ | ID list segment up to 15,000 IDs | Segment with included targets | IDs are read through the Console API (on demand for larger lists) and written as included targets of the right context kind. | Decisions: `id_list_unavailable`. Edge cases: 9.2, 9.5. [StatSig](https://docs.statsig.com/segments/add-id-list) · [LD](https://launchdarkly.com/docs/home/flags/segments) |
| 🚧 | ID list segment above 15,000 IDs | Big segment (list-based, CSV import; Enterprise) | Blocked by a big_segment decision until the CSV import path ships; the list can still be exported. | Decisions: `big_segment`. Edge cases: 9.3. [LD](https://launchdarkly.com/docs/home/flags/big-segments) |
| 🚧 | ID lists from a config spec (hashed IDs only) | Segment, after reconciliation with a raw-ID CSV | Config specs ship ID lists as one-way hashes; a hashed_id_list decision asks for a raw-ID CSV or a Console key. | Decisions: `hashed_id_list`. Edge cases: 9.4. |
| 🚧 | Analysis lists and user-store lists | Segment (treated like an ID list) | Read like ID lists; not yet exercised against a real project. | Edge cases: 9.10. |

### Rule conditions

Every StatSig condition type, and what clause it becomes.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| ✅ | public, user_id, unit_id (custom ID), email, country, locale, app_version, ip_address, custom_field | Clauses on the mapped attribute of the right context kind | Attribute names come from the mapping profile (email → email, custom_field f → f); reserved LD names (key, kind, _meta, anonymous) are prefixed. | Edge cases: 5.8, 5.9. [StatSig](https://docs.statsig.com/feature-flags/conditions) · [LD](https://launchdarkly.com/docs/home/flags/targeting-rules) |
| 🟡 | Derived attributes: browser_name/version, os_name/version, device_model, user_agent, IP-derived country | Clauses on attributes the app must now send | LD SDKs never parse user agents or geolocate IPs, so each derived attribute is a derived_attribute decision and goes into the context contract for developers. | Decisions: `derived_attribute`. Edge cases: 5.1, 5.2. |
| ✅ | environment_tier | Resolved statically per environment | True in this environment → condition dropped; false → rule dropped. Non-static operators on the tier name are an unsupported_condition. | Edge cases: 2.2, 2.3, 2.4. |
| ✅ | passes_segment / fails_segment | segmentMatch clause (negated for fails) | The segment is pulled into the plan as a dependency in the same environment; a missing or archived segment is a missing_reference decision. | Decisions: `missing_reference`. Edge cases: 5.5, 5.6, 5.7. |
| 🟡 | time (before/after a timestamp, evaluated against the SDK clock) | No clause can read the clock | A window entirely in the past is resolved statically; a future one is a time_condition decision (scheduled flag change later). | Decisions: `time_condition`. Edge cases: 5.3. [LD](https://launchdarkly.com/docs/home/releases/scheduled-changes) |
| 🟡 | target_app, url, javascript, experiment_group, user_bucket, unknown types | — | No LD clause can express these; an unsupported_condition decision offers drop the condition, drop the rule, or skip the item. Nothing is dropped silently. | Decisions: `unsupported_condition`. Edge cases: 5.4. |

### Operators

StatSig compares loosely and case-insensitively; LaunchDarkly compares typed values. Each mismatch is a decision.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🟡 | any, none, str_contains_any/none, str_starts_with_any, str_ends_with_any (case-insensitive) | in, contains, startsWith, endsWith (case-sensitive) | A case_insensitive_match decision: an exact case-folded regex (recommended), lower/upper-case variants, or exact match. Skipped when no value has letters. | Decisions: `case_insensitive_match`. Edge cases: 6.1, 6.13. |
| ✅ | any_case_sensitive, none_case_sensitive, eq, neq, gt, gte, lt, lte, before, after | in (negated for none/neq), numeric and date operators | Direct translation; numeric targets add a note that the attribute must be sent as a number. | Edge cases: 6.5, 6.6, 6.8. |
| 🟡 | Numeric targets compared loosely ("2" == 2) | Typed comparison ("2" ≠ 2) | A value_type decision: emit both the number and the string form (recommended), numbers only, or strings only. | Decisions: `value_type`. Edge cases: 6.2, 6.10. |
| 🟡 | none / neq / str_contains_none pass when the attribute is missing | A clause on a missing attribute never matches, even negated | Acknowledged per rule (negated_missing_attribute); users without the attribute no longer match. | Decisions: `negated_missing_attribute`. Edge cases: 6.3, 15.1. |
| 🟡 | version_gt/gte/lt/lte/eq/neq (any number of parts, suffix stripped) | semVer* operators (strict semver) | version_gte → semVerLessThan negated, etc.; 1.2 is padded to 1.2.0; 4-part or pre-release targets raise a version_format decision. | Decisions: `version_format`. Edge cases: 6.7. [LD](https://launchdarkly.com/docs/home/flags/operators) |
| 🟡 | on (same calendar day, SDK local time) | after day−1 and before day+1 (UTC) | Expanded into two clauses with a note; the local-day vs UTC-day difference is documented. | Edge cases: 6.8. |
| 🟡 | str_matches (JavaScript regex) | matches (each SDK’s regex engine) | Patterns using lookbehind, backreferences or other non-portable constructs raise a regex_dialect decision. | Decisions: `regex_dialect`. Edge cases: 6.9, 15.3. |
| 🟡 | array_contains_any/none/all, not_array_contains_all | in on array attributes; all → one clause per value; not-all → one rule per value | Translated with expansion; large expansions raise rule_expansion. | Decisions: `rule_expansion`, `value_type`. Edge cases: 6.10, 4.10. |
| 🟡 | is_null / is_not_null | No "is set" operator | is_not_null ≈ matches ".*" (strings only); is_null is blocking: drop the rule or skip. | Decisions: `null_check`. Edge cases: 6.4. |
| 🟡 | encoded_any | — | The current StatSig SDKs themselves treat it as unsupported; raised as unsupported_condition. | Decisions: `unsupported_condition`. Edge cases: 6.11. |
| 🚧 | in_segment_list / not_in_segment_list (config spec only) | segmentMatch against the reconciled list segment | Depends on ID-list reconciliation for spec sources. | Decisions: `hashed_id_list`. Edge cases: 6.12. |

### Experiments, layers, holdouts and Autotune

Nothing is moved mid-flight: running experiments end in StatSig and new ones launch in LaunchDarkly, with the structure (flags, layers, holdouts, metrics) carried over.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🚧 | Experiment not started (setup) | JSON flag (a variation per group) + draft LD experiment | The flag and a not-started experiment draft with hypothesis, treatments, allocation, randomization unit and metrics. | Edge cases: 11.3, 11.4, 11.5. [StatSig](https://docs.statsig.com/experiments-plus) · [LD](https://launchdarkly.com/docs/home/experimentation) |
| 🧭 | Running experiment (active) | Cannot be moved mid-flight | Shown as "running in StatSig, migrate after it ends"; optionally pre-stage the draft. Assignments and results never move. | Re-randomizing a live experiment would invalidate its results; finish or stop it in StatSig first. Edge cases: 11.1. |
| 🚧 | Concluded experiment (decision made, group shipped) | Flag serving the shipped group’s values at 100% | The shipped group becomes the fallthrough; results are archived (see Operations). | Edge cases: 11.2. |
| 🚧 | Layers (explicit) and layer parameters | LD layers with reservations | Layers are created so new experiments stay mutually exclusive; code reading getLayer().get() gets a layer_parameters decision. | Implicit (one-experiment) layers are dropped. Edge cases: 11.6. [StatSig](https://docs.statsig.com/layers) · [LD](https://launchdarkly.com/docs/home/experimentation/layers) |
| 🚧 | Holdouts (global or attached) | LD holdouts (new populations, per environment) | A new holdout population with the same percentage; the gates and experiments it covered become a checklist. Membership is re-randomized. | Edge cases: 11.7, 4.8. [StatSig](https://docs.statsig.com/holdouts) · [LD](https://launchdarkly.com/docs/home/holdouts) |
| 🟡 | Autotune (multi-armed bandit) | JSON flag + custom metric + bandit experiment (type: mab), drafted | A variation per arm, the success event as a conversion metric, and a draft bandit on the default rule; a running Autotune waits (autotune_running) or is pre-staged. | LD cannot import a finished bandit’s learning: a concluded Autotune becomes a flag serving the winner at 100%. Decisions: `autotune_running`, `missing_metric`, `duplicate_variant_value`, `key_collision`. Edge cases: 11.8, 11.9, 11.10, 11.11, 11.12, 11.13, 11.14, 11.15. [StatSig](https://docs.statsig.com/autotune) · [LD](https://launchdarkly.com/docs/home/experimentation/bandits) |
| ❌ | Contextual bandits (Autotune AI) | — | LD bandits are not contextual; use a plain bandit or an experiment per context segment. | [StatSig](https://docs.statsig.com/autotune/contextual) |
| 🧭 | Analysis settings: CUPED, sequential testing, Bonferroni/BH, stratified sampling, switchback, one-sided tests | LD analysis configuration (Bayesian/frequentist, CUPED, sequential) | Experiment analysis is configured per LD experiment when it is created; the console lists StatSig settings for reference. Switchback experiments have no LD equivalent. | [StatSig](https://docs.statsig.com/stats-engine) · [LD](https://launchdarkly.com/docs/home/experimentation/analyze) |
| 🚧 | Experiment / layer / Autotune overrides (forced groups, conditional overrides) | Individual targets on the experiment flag | Forced groups become individual targets; conditional overrides become rules ahead of the experiment rule. | Edge cases: 8.6. |

### Metrics and events

Metric definitions can be translated; the events behind them have to be re-instrumented through the LaunchDarkly SDK.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🚧 | Cloud metrics: event count, sum, mean, ratio, funnel | Custom conversion / numeric, ratio and funnel metrics | Definitions are translated (porting the statsig-to-ld metrics converter); events must then be sent through LD track(). | Metrics are the critical path for every new LD experiment, so they are a dependency of experiment migration. Edge cases: 12.1, 12.4. [StatSig](https://docs.statsig.com/metrics) · [LD](https://launchdarkly.com/docs/home/metrics) |
| ❌ | Composite metrics, user accounting (DAU/WAU/retention) and other derived types | — | No LD metric type composes other metrics; rebuild as separate metrics or a metric group. | Edge cases: 12.1. |
| 🧭 | Events logged to StatSig (logEvent) | Events sent through the LD SDK (track) | An instrumentation checklist per event: same event key, sent via track() with the same context. | Edge cases: 12.2. [LD](https://launchdarkly.com/docs/sdk/features/events) |
| 🧭 | Warehouse Native metric sources and SQL metrics | Warehouse-native metrics on an LD data source | The LD data source must be created in the LD UI by an admin; once it exists, metric sources and SQL can be mapped (custom and ratio only, no funnels). | Edge cases: 12.3. [StatSig](https://docs.statsig.com/statsig-warehouse-native/introduction) · [LD](https://launchdarkly.com/docs/home/metrics/warehouse-native) |
| ❌ | Metrics from a config-spec-only source | — | Config specs carry no metric definitions; add a Console API key or define metrics in LD by hand. | Edge cases: 12.5. |

### Parameter stores

Parameter stores are a StatSig SDK convenience over gates, configs and experiments.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🚧 | Parameter store with static parameters | One JSON flag per store | Static parameters become one JSON flag; gate-, config- and experiment-backed parameters point at the migrated flags with a code-change note. | Edge cases: 13.1, 13.2. [StatSig](https://docs.statsig.com/client/concepts/parameter-stores) |

### Operations, history and analytics

Things around the configuration: history, results, dashboards, alerts, integrations.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🧭 | Change history, audit log, versions | LD audit log (from the first sync onward) | StatSig history is kept in the console’s snapshots and exported with the workspace; every LD write names the StatSig version and run in its audit comment. | [StatSig](https://docs.statsig.com/console-api/audit-logs) · [LD](https://launchdarkly.com/docs/home/account/audit-log) |
| 🚧 | Experiment results (Pulse), cumulative exposures | — | Archived to a file per experiment and linked from the LD flag; LD cannot import results. | Edge cases: 11.2. |
| ✅ | (the migration itself) | Tags, custom properties and audit comments on every migrated resource | statsig-migrated and statsig-src-<alias> tags, statsig.* custom properties, per-environment sync fingerprints; the LD project is the migration ledger. | Edge cases: 1.8. |
| ❌ | Dashboards, alerts, reports, product and web analytics, session replay | LD Observability (different product, separate instrumentation) | Not migrated. StatSig analytics stay in StatSig; LD observability is set up on its own. | [StatSig](https://docs.statsig.com/product-analytics/overview) · [LD](https://launchdarkly.com/docs/home/observability) |
| ❌ | Integrations (Slack, Datadog, Jira, data warehouse ingestion, webhooks) | LD integrations | Reconnected in LD by hand. | [StatSig](https://docs.statsig.com/integrations/introduction) · [LD](https://launchdarkly.com/docs/integrations) |
| ❌ | Prompts / AI configs and evals | LD AI Configs | Different models of a prompt; recreate in LD AI Configs. | [LD](https://launchdarkly.com/docs/home/ai-configs) |

### SDK and runtime behaviour

Behaviour the SDK provides at evaluation time, which a configuration migration cannot carry.

| | StatSig | LaunchDarkly | How the console handles it | Notes |
|---|---|---|---|---|
| 🟡 | Bucketing: sha256(salt.ruleSalt.unitID) | Bucketing: hash(flagKey.salt.key) | Every partial rollout re-buckets users; acknowledged once per rule. Finish or hard-code rollouts in StatSig first when continuity matters. | Decisions: `partial_rollout_rebucket`. Edge cases: 4.1. |
| 🧭 | checkGate / getConfig / getExperiment / getLayer calls | boolVariation / jsonVariation calls | LD keys equal StatSig names, so ld-find-code-refs finds every call site; the console lists the code changes per item. | [LD](https://launchdarkly.com/docs/home/observability/code-references) |
| 🧭 | Attributes the SDK derives or looks up loosely (user agent, IP, case-insensitive custom fields, numeric strings) | Attributes the app must send, exactly named and typed | Collected into a context contract for developers: attribute names, types, context kinds and multi-context requirements. | Edge cases: 3.5, 5.8, 6.6. |
| ❌ | Persistent assignment, bootstrapping, local evaluation, data adapters | LD equivalents configured per SDK (Relay Proxy, bootstrapping, persistent stores) | SDK runtime configuration is re-done in each app with the LD SDK. | [StatSig](https://docs.statsig.com/server/concepts/persistent_assignment) · [LD](https://launchdarkly.com/docs/sdk/features/bootstrapping) |

<!-- coverage:end -->
