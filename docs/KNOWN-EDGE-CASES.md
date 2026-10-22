# Known edge cases: StatSig → LaunchDarkly

A running list of every place where a StatSig resource does not migrate cleanly to LaunchDarkly,
across all resource types. It is the mapper's conscience: anything listed as a **gap** here is
work the mapper still owes (CLAUDE.md: *every imperfect mapping becomes a Decision*).

**How to keep it current.** When you find a new mismatch:
1. Add a row in the right section below (StatSig behaviour, LD behaviour, how the app handles it).
2. Add a demo example to `packages/demo-fixtures/src/acme/web.ts` (or `mobile.ts`) whose
   description names the edge case, then run `pnpm fixtures:generate`.
3. Add a test under *known edge cases* in `packages/mapper/test/mapper.test.ts`, and review the
   golden-file diff (`packages/mapper/test/golden/`), which is what lands in a customer's LD project.

**Sources of truth.** StatSig semantics come from the SDK evaluator, not the docs:
`reference/repos/node-js-server-sdk/src/Evaluator.ts` and `src/utils/EvaluatorUtils.ts`. LD
semantics come from `reference/launchdarkly/openapi.json`, `semantic-patch-*.md` and the live
checks recorded in `reference/README.md`. Field names come from the OpenAPI specs.

**Handling legend**

| Mark | Meaning |
|---|---|
| ✅ Decision | Raised as a Decision of the named type (PLAN §8). The user must answer. |
| 📝 Note | Handled automatically but reported as a fidelity note (partial fidelity where it says so). |
| ⚙️ Static | Translated exactly, silently. |
| 🚧 Gap | Known mismatch the app does **not** yet surface. Mapper backlog; see §17. |
| 📅 Later | Belongs to a later milestone (M4 configs, M5 monitoring, M6/M7 experiments, M8 consolidation). Fixtures are already seeded. |
| ❌ Manual | No LD equivalent. Guidance only. |
| ❓ Verify | Believed true; not yet checked against a live LD project or StatSig key. |

Decision types referenced below are defined in `packages/mapper/src/types.ts` (`DecisionType`).

---

## 1. Keys, names, tags, owners (the project-level flag shell)

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 1.1 | Name characters | Names may contain spaces, capitals and `.` (`^[a-zA-Z0-9_\-. ]*$` in the Console OpenAPI). | Keys allow only letters, digits, `.`, `_`, `-`. | ⚙️ `sanitizeKey` replaces other runs with `_` and strips leading `._-`; 📝 note when the key differs. 🚧 Two StatSig names can sanitize to one key (`a b` vs `a_b`); only collisions with existing LD keys are checked today (`key_collision`). | `Holiday Banner 2026` → `Holiday_Banner_2026` |
| 1.2 | Shared names across resource types | A gate, a config and an experiment may all be called `x`. | One key space per project. | 📅 `key_collision` at plan time once configs (M4) and experiments (M6) are mapped. | gate + config `maintenance_mode` |
| 1.3 | Names differing only by case | Distinct resources. | Distinct keys (keys are case-sensitive), but easy to confuse. | ⚙️ nothing to do; worth a UI hint. | — |
| 1.4 | Tags | Any text, including symbols. | Letters, digits, `.`, `_`, `-`, ≤ 64 chars. | ⚙️ `sanitizeTag` (NFKD, lower-case, truncate); 📝 note per renamed tag. 🚧 Lower-casing can merge `Checkout` and `checkout`. | `★ Core` → `core` on `eu_cookie_banner` |
| 1.5 | Owner → maintainer | Owner email, possibly of someone who left. | Maintainer must be an LD member. | 🚧 `maintainer_unknown` (PLAN §8.3) not implemented; the shell only carries `statsig.owner` as a custom property. | gates owned by `jordan.former@…` |
| 1.6 | Lifecycle → `temporary` | `type`: PERMANENT / TEMPORARY / STALE / TEMPLATE. | `temporary: boolean`. | ⚙️ PERMANENT → `false`, else `true`. 📝 STALE gates get a "consider hard-coding" note. | `stale_promo_ribbon`, `stale_reviews_widget` |
| 1.7 | Target apps → SDK visibility | Client SDKs can evaluate every gate; target apps only scope keys. | Flags are sent to client / mobile SDKs only when `clientSideAvailability` allows it. | ✅ `client_side_availability` on every gate (recommended: both). | every gate; `storefront_url_banner` is client-only |
| 1.8 | Provenance | — | Custom properties can't be in the same semantic patch as environment instructions (400); several writes to one flag within seconds return 429. | ⚙️ executor writes the shell and each environment separately and backs off. | every migration |
| 1.9 | Review settings, release pipelines, safeguards, automated rollouts, metric lifts | Per-gate settings. | Approvals / release pipelines / guarded rollouts, configured differently. | ❌ Manual (PLAN §6). | `kill_switch_payments` (PERMANENT) |

## 2. Environments

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 2.1 | Tier with no LD environment | Custom tiers (e.g. `qa`). | Fixed environment list per project. | ✅ mapping profile (`envMapping: null`); rules that only apply there are dropped with a 📝 note in mapped environments. | `qa`, `qa_debug_panel` |
| 2.2 | Two ways to scope a rule | Console API: `rule.environments`; config spec: an `environment_tier` condition. | Per-environment targeting. | ⚙️ both resolved statically per environment (`resolveRulesForEnvironment`). | `perf_monitoring_v2`, `staff_debug_tools` |
| 2.3 | `environment_tier` with a non-static operator | `str_matches`, `version_*` on the tier name. | — | ✅ `unsupported_condition` (blocking). | — (test only) |
| 2.4 | Tier name case | Compared case-insensitively. | n/a | ⚙️ case-insensitive match. | — |
| 2.5 | A flag exists in every LD environment | Gate state is per environment. | Creating a flag creates it in all environments, off. | ⚙️ unmigrated environments serve `false` even if switched on (`defaults.onVariation = Fail`); shown as *Not migrated*. | any gate migrated to staging only |
| 2.6 | Several sources → one LD environment | — | — | 📅 M8 consolidation. | `acme-web` + `acme-mobile` → `production` |

## 3. Unit types → context kinds

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 3.1 | Custom unit IDs | `userID`, `stableID`, custom (`companyID`, `deviceID`). | Context kinds; `user` is built in. | ⚙️ `userID` → `user`, `stableID` → `device`, `fooID` → `foo`; ✅ `unit_type_kind` when the kind doesn't exist in LD. Never collapsed into `user` (CLAUDE.md). | `b2b_bulk_ordering`, `anon_homepage_variant`, mobile `device_beta_program` |
| 3.2 | Two unit types defaulting to one kind | `stableID` and `deviceID` in one project. | Both default to `device`. | 🚧 No warning; the second would silently share the kind. | `acme-mobile` has both |
| 3.3 | Unit type lookup | `customIDs` are looked up case-insensitively. | n/a | ⚙️ `kindFor` matches case-insensitively. | — |
| 3.4 | Custom-ID overrides on a userID gate | `passingCustomIDs` without saying which unit type. | Targets need a context kind. | 🚧 Adapter warns `ambiguous_override` and records unit type `customID`; the mapper then asks for a context kind named `custom`, which is misleading. Should ask *which* unit type. | `search_v2` override `acct_3001` |
| 3.5 | Conditions on another unit's attributes | A `userID` gate may test `unit_id(companyID)`. | The SDK must send a multi-context with both kinds. | 📝 implied by the clause's context kind; 🚧 the generated *context contract* (PLAN §10.5) is not built yet. | `b2b_bulk_ordering`, `enterprise_sso` |
| 3.6 | `segmentMatch` and context kinds | Segment `idType` decides whose ID is checked. | The mapper emits `contextKind: "user"` on every `segmentMatch` clause; LD segments carry `includedContexts` per kind. | ❓ Verify that LD ignores the clause's kind for `segmentMatch` with non-user segments. | `enterprise_sso` (companyID segment), mobile `device_beta_program` |

## 4. Gate rules and rollouts

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 4.1 | Partial rollout | `sha256(salt.ruleSalt.unitID)`. | `hash(flagKey.salt.key)`. The same percentage, different users. | ✅ `partial_rollout_rebucket` (acknowledge); 📝 partial. | `new_checkout_flow` 20 %, `perf_monitoring_v2` 10 %, `anon_homepage_variant` 50 % |
| 4.2 | 0 % rule | Matching users fail and evaluation stops: an exclusion. | A rule serving `false`. | ⚙️ exact. | `reviews_v2` |
| 4.3 | Public 100 % rule | Everyone passes; later rules are unreachable. | Fallthrough. | ⚙️ becomes the fallthrough; 📝 note counts the dropped rules. | `free_returns`, `kill_switch_payments` |
| 4.4 | Public partial rule | Everyone is bucketed. | Fallthrough rollout. | ⚙️ + ✅ re-bucket acknowledgement. | `new_checkout_flow` |
| 4.5 | No rules | Everyone fails. | On, serving `false`. | ⚙️; 📝 STALE_NO_RULES note. | `payments_v3_scaffold` |
| 4.6 | Disabled gate | Everyone fails, overrides included. | Off, serving the off variation. | ⚙️ exact; 📝 note. | `old_cart_drawer` |
| 4.7 | Archived gate | Not evaluable. Absent from config specs. | — | ⚙️ skipped. 📅 M5: archived *after* migration should propose retiring the LD flag. | `legacy_wishlist`; `legacy_browser_banner` in snapshot 2 |
| 4.8 | Holdouts attached to a gate | A holdout forces `false` for its share of users *before* the rules. | LD holdouts are separate populations (PLAN §11). | 🚧 `holdoutIds` are ignored: held-out users get the feature in LD. Needs at least a note, ideally an LD holdout. | `new_checkout_flow` (5 % `checkout_holdout`), `global_holdout` 2 % |
| 4.9 | Rule-level unit type | A rule may bucket on a different `idType` than the gate (spec sources). | Rollout `contextKind` per rule. | ⚙️ `serveFor` uses the rule's `idType`. | — |
| 4.10 | Rule expansion | One rule with several OR-ish conditions (`not_array_contains_all`, `on`, inlined gates). | One LD rule per DNF term. | ✅ `rule_expansion` (blocking) above 10 LD rules. | `cross_sell_matrix` (4 × 3 = 12) |
| 4.11 | Pass-percentage precision | Decimals allowed. | Weights in thousandths of a percent. | ⚙️ `Math.round(p × 1000)`: exact to 0.001 %. | — |
| 4.12 | Unreachable duplicate rules | Allowed. | Allowed. | ⚙️ copied as is (only rules after a public 100 % rule are dropped). | — |

## 5. Condition types

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 5.1 | Derived attributes | `browser_*`, `os_*`, `device_model`, `user_agent` are parsed from the UA; `country` from the IP, when the app doesn't send them. | SDKs never derive attributes. | ✅ `derived_attribute` (map; the app must send the attribute). 📝 partial. | `dark_mode`, `legacy_browser_banner`, `eu_cookie_banner`, `bot_detection_challenge` |
| 5.2 | `country` provenance | The Console API can't say whether a `country` condition relies on IP lookup or on `user.country`. | — | 📝 Conservative: every Console `country` is treated as IP-derived, so the decision is always raised. The spec distinguishes `ip_based` from `user_field`. | `checkout_targeting_gate` |
| 5.3 | `time` conditions | Compared to the SDK clock at evaluation. | No clause can read the clock. | ⚙️ resolved statically when the answer can't change (past window); ✅ `time_condition` otherwise (scheduled change arrives with M4). 🚧 `on` is "same day in the SDK host's local time zone" in StatSig; the mapper uses UTC days. | `holiday_sale_2025` (static), `black_friday_2027` (decision) |
| 5.4 | `target_app`, `javascript`, `experiment_group`, `url`, `user_bucket`, unknown types | Evaluated inside StatSig only. | No equivalent. | ✅ `unsupported_condition` (blocking: drop condition / drop rule / skip). Never dropped silently. | `storefront_app_only`, `storefront_url_banner`, mobile `webview_checkout_fallback`, `onboarding_followup`, `legacy_partner_allowlist` |
| 5.5 | Segment references | `passes_segment` / `fails_segment`. | `segmentMatch` (negated for fails) + the segment as a dependency in the same environment. | ⚙️; ✅ `missing_reference` when the segment isn't in the snapshot or is archived; `big_segment` / `hashed_id_list` / `id_list_unavailable` for lists that can't be built yet. | `referral_bonus` (missing), `block_fraudulent_checkout`, `wholesale_portal` |
| 5.6 | Several segments in one condition | Spec `multi_pass_gate` on `segment:` names: *any* listed segment. | — | ⚙️ "passes any" → one clause with several segment keys; "fails any one" → one rule per segment. | — |
| 5.7 | Referencing a segment that can't migrate | — | — | 📝 The gate itself maps as *full*; the **planner** blocks it as a dependency problem. Don't read gate fidelity as "ready". | `early_adopter_badge` → `early_adopters` |
| 5.8 | Custom field names | Looked up as given, then lower-cased, then under `custom` and `privateAttributes` (`getFromUser`). | Attribute names are case-sensitive; `key`, `kind`, `_meta`, `anonymous` are reserved. | ⚙️ reserved names → `custom_<field>` with a 📝 note. 🚧 Case-insensitive fallback isn't reproduced: the app must send the exact name (context contract). | — |
| 5.9 | Private attributes | `privateAttributes` are evaluated but not logged. | Same, via `_meta.privateAttributes`. | ⚙️ no mapping needed; 🚧 belongs in the context contract. | — |
| 5.10 | User agents over 1000 chars | Treated as missing. | Evaluated. | ⚙️ ignore (trivia). | — |

## 6. Operators

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 6.1 | `any`, `none`, `str_contains_any/none`, `str_starts_with_any`, `str_ends_with_any` | Both sides lower-cased (`stringCompare(true, …)`). | `in`, `contains`, `startsWith`, `endsWith` are case-sensitive. | ✅ `case_insensitive_match`: case-folded `matches` regex (exact, recommended), lower/upper variants, or exact. ⚙️ skipped when no value has cased letters. | `search_v2`, `employees_only`; `maintenance_mode` (IPs: no decision) |
| 6.2 | `any` on numbers | Both sides go through `String()`: target `2` matches attribute `2` and `"2"`. | `in` compares typed JSON values: `"2"` ≠ `2`. | 🚧 Targets are stringified with no decision. Needs: keep numbers typed, or warn to send strings. | `loyalty_tier_perks` (`[2, 3]`) |
| 6.3 | Negative operators on a missing attribute | `none`, `none_case_sensitive`, `str_contains_none`, `neq` **pass** when the attribute is absent. | A clause on a missing attribute never matches, negated or not. | ✅ `negated_missing_attribute` (acknowledge); 📝 partial. Not raised for `user.key`. | `search_typo_tolerance` |
| 6.4 | `is_null` / `is_not_null` (spec: `eq null` / `neq null`) | Attribute presence. | No "is set" clause. | ✅ `null_check`: `is_not_null` ≈ `matches ".*"` (strings only); `is_null` is **blocking** (drop rule / skip). | `missing_email_prompt`, `sms_notifications` |
| 6.5 | `eq` / `neq` | Loose equality (`==`): `"5" == 5`. Spec-only (not in the Console enum). | `in` (negated for `neq`), typed. | ⚙️ mapped; 🚧 same typing caveat as 6.2; `neq` also hits 6.3. | — (test only) |
| 6.6 | Numeric `gt` / `gte` / `lt` / `lte` | `Number()` coerces numeric strings. | Numeric operators need numeric attribute values. | ⚙️ mapped; 🚧 contract note that the app must send numbers. | `gift_card_upsell` |
| 6.7 | Version comparisons | Missing parts padded with `0`; anything after `-` stripped; any number of parts (`5.2.0.100`). | SemVer: 4-part strings are invalid (clause never matches); `5.3.0-beta` sorts **below** `5.3.0`; missing minor/patch tolerated ❓. | ⚙️ `version_gte` → `semVerLessThan` + negate, `version_lte` → `semVerGreaterThan` + negate, `version_neq` → `semVerEqual` + negate (CLAUDE.md pitfall). 🚧 Non-semver targets aren't detected. | mobile `android_min_version`, `beta_channel_features`; `windows_download_cta` |
| 6.8 | Dates: `before` / `after` / `on` | Targets and values: date strings, then epoch seconds or ms (heuristic). `on` = same local calendar day. | `before` / `after` need RFC 3339 strings or epoch **milliseconds**; `on` has no operator. | ⚙️ targets normalised (`toTimestamp`); `on` → `after day−1 ms` ∧ `before day+1` in UTC (📝 expands). 🚧 Attribute values in epoch seconds read as 1970 in LD; local-day vs UTC-day. | `new_customer_onboarding` |
| 6.9 | `str_matches` | JavaScript `RegExp`; values ≥ 1000 chars never match; invalid pattern → false. | `matches`, evaluated by each SDK's regex engine (RE2 in Go has no lookbehind, backreferences, …). | ✅ `regex_dialect` when non-portable constructs are detected (keep / drop / skip). | `sku_preview` |
| 6.10 | Array operators | `array_contains_*` also match `parseInt(target)` against numeric arrays. | `in` on array attributes, typed. | ⚙️ `any`/`none` → one clause; `all` → one clause per value; `not_array_contains_all` → one **rule** per value (📝). 🚧 numeric typing as 6.2. | `wishlist_sharing`, `bundle_recommendations` |
| 6.11 | `encoded_any` | In the Console enum; the current SDK evaluator returns *unsupported* (false). | — | ✅ `unsupported_condition` (blocking). | `legacy_partner_allowlist` |
| 6.12 | `in_segment_list` / `not_in_segment_list` (spec) | Hashed ID-list membership. | `segmentMatch` against the reconciled list segment. | ✅ via `hashed_id_list` until reconciled (M4). | spec `wholesale_partners` |
| 6.13 | `user_id any [...]` with cased IDs | Case-insensitive on the ID. | `user.key` is case-sensitive. | ✅ same `case_insensitive_match`; the regex option works on `key`. | — |
| 6.14 | Unknown operator string | — | — | ✅ `unsupported_condition`; adapters keep the operator verbatim and warn. | — |

## 7. Gate references (`passes_gate` / `fails_gate`, PLAN §10.4)

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 7.1 | Referenced gate has only 100 % rules | Evaluate X inline. | — | ⚙️ inlined: OR of X's rules, plus X's pass overrides, minus its fail overrides (trailing 0 % rules ignored). Drift in X is drift in the referrer (fingerprint). | `checkout_promo_banner` → `employees_only` |
| 7.2 | Referenced gate disabled | Always fails. | — | ⚙️ `passes` → never, `fails` → always. | — |
| 7.3 | Referenced gate has a partial rollout, required by **every** rule | — | Prerequisite flag (Enterprise). LD checks prerequisites **before** individual targets, so pass overrides on the referrer stop applying to users who fail X. | ✅ `gate_reference` (choice, recommended: prerequisite; 📝 partial when the referrer has pass overrides). X is migrated first in the same environment. | `checkout_express_pay` → `new_checkout_flow` |
| 7.4 | …required by only **some** rules | — | A prerequisite would gate every rule. | ✅ `gate_reference` (blocking: drop condition / drop rule / skip). | `checkout_upsell_v2` |
| 7.5 | `fails_gate` on a partial-rollout gate | — | No negated prerequisite. | ✅ `gate_reference` (blocking). | `express_pay_fallback` |
| 7.6 | `fails_gate` on an inlinable gate | — | — | ⚙️ De Morgan over the inlined DNF (capped at 10 rules). | `non_staff_survey` |
| 7.7 | `fails_gate` on a gate with overrides | Overrides make "fails X" depend on IDs. | — | ✅ `gate_reference` (blocking): can't inline exactly. | `consumer_pricing` → `b2b_bulk_ordering` |
| 7.8 | Reference cycles | A → B → A. | Prerequisite cycles are rejected. | 🚧 The mapper still offers *prerequisite* when every rule requires the gate; the **planner** reports "Prerequisites form a cycle" and refuses. Should be blocking in the mapper. | — (test only) |
| 7.9 | Nesting deeper than 4 | — | — | ✅ `gate_reference` (not inlinable). | — |
| 7.10 | `multi_pass_gate` / `multi_fail_gate` (spec) | Any listed gate. | — | ⚙️ OR of the inlined gates. | — |
| 7.11 | Prerequisite availability unknown | — | Enterprise feature. | ✅ offered when the capability probe says `unknown`; checked on the first write. Not offered when `not_permitted` / `unavailable` (then blocking). | — |
| 7.12 | Referenced gate archived or not in the snapshot | — | — | ✅ `gate_reference` (blocking) with the reason. | — |

## 8. Overrides → individual targets

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 8.1 | One ID overridden both ways | Allowed: all-environment fail + environment pass. | Each key can be in one variation per flag. | 📝 environment-specific overrides win, then the first; the conflict count is a partial note. | `new_checkout_flow`: `user-vip-complainer` (fail everywhere, pass in staging) |
| 8.2 | Overrides evaluated before rules | Yes. | Individual targets are evaluated before rules, but **after prerequisites**. | 📝 see 7.3. | `checkout_express_pay` |
| 8.3 | Overrides in an unmapped environment | — | — | ⚙️ dropped for the mapped environments. | `qa` |
| 8.4 | Custom-ID overrides | Per unit type. | Targets per context kind. | ⚙️ `contextKind` from the unit type; 🚧 3.4 when the type is unknown. | `b2b_bulk_ordering` |
| 8.5 | Very long override lists | Unbounded. | Individual targets are fine, but LD recommends segments for large lists ❓ limit. | 🚧 no threshold check. | — |
| 8.6 | Experiment group overrides | Force a group. | Individual targets on the experiment flag. | 📅 M6. | `search_ranking_v3` → `user-search-qa` |
| 8.7 | Spec encoding of environment-scoped overrides | Rule `pass:<env>:id_override` + `environment_field` condition (UNVERIFIED, our generator's guess). | — | ❓ confirm with a real spec that has environment overrides. | generated specs |

## 9. Segments

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 9.1 | Scope | Project-wide. | Per environment. | ⚙️ one LD segment per mapped environment, same key. | every segment |
| 9.2 | ID lists ≤ 15 000 | Plaintext via the Console API (deferred above the eager limit). | List segment (`included` for `user`, `includedContexts` otherwise). | ⚙️; ✅ `id_list_unavailable` until fetched (the plan fetches on demand). | `vip_customers` (25), `wholesale_partners` (2 500) |
| 9.3 | ID lists > 15 000 | — | Big segment with CSV import (Enterprise). | ✅ `big_segment` (blocking) until M4. | `fraud_blocklist` (20 000) |
| 9.4 | Hashed lists (spec) | `get_id_lists` ships `base64(sha256(id))[0:8]`. | — | ✅ `hashed_id_list`; 📅 M4 raw-ID reconciliation (demo CSV is 99.6 % complete). | spec `wholesale_partners` |
| 9.5 | Empty ID list | 0 members. | Empty segment. | ⚙️. | `beta_waitlist` |
| 9.6 | Rule with a pass percentage | Sample of matching users. | Weighted segment rule (re-bucketed). | ✅ `partial_rollout_rebucket` (acknowledge). | `churn_risk` (10 %) |
| 9.7 | Disabled segment | Nobody matches. | Segment with no rules. | 📝 note. | `legacy_partners` |
| 9.8 | Gate reference inside a segment | Allowed. | Segments have no prerequisites. | ⚙️ inlined when exact; otherwise the segment is **skipped** (and gates using it are blocked in the plan). | `staff_or_beta` (inlined), `early_adopters` (skipped) |
| 9.9 | "Everyone" rule | `public`. | A segment rule needs a clause. | ⚙️ `key matches ".*"` on the segment's kind. | — |
| 9.10 | `analysis_list` / `user_store_id_list` types | Other list kinds. | — | 🚧 treated like `id_list`; untested. | — |
| 9.11 | Deleting a segment a flag still targets | — | 409. | ⚙️ undo deletes flags before segments. | runs → Undo |
| 9.12 | Same segment name in two sources with different rules | — | — | 📅 M8 `source_collision`. | `beta_testers` (web vs mobile) |

## 10. Dynamic configs (M4; fixtures seeded)

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 10.1 | Values are per rule; variations are project-level | A new `returnValue` in one environment. | The variation list is shared by all environments. | 📅 append-only variations; `variation_change_affects_migrated_env` when a migrated environment is affected (PLAN §7). | `shipping_thresholds` gains `Australia` in snapshot 2 |
| 10.2 | Rule value equal to the default | Allowed. | No new variation needed. | 📅 dedupe by value. | `legacy_pricing_rules` |
| 10.3 | Rule variants (split within a rule) | Cumulative bucket split. | Rollout across variations (re-bucketed). | 📅 + re-bucket acknowledgement. | `homepage_hero` (50/30/20) |
| 10.4 | Partial-rollout rule on a config | Users matching the rule but outside the percentage: default, or next rule? | — | ❓ verify against a real project (PLAN §10.2). | `api_rate_limits` (50 %) |
| 10.5 | JSON schema | Validates rule values in the console. | No schema on JSON variations. | ❌ note only. | `checkout_config` |
| 10.6 | Disabled config | Returns the default. | Off, serving the default variation. | 📅. | `legacy_pricing_rules` |
| 10.7 | Per-parameter reads | `getConfig("x").get("p", d)` falls back per key. | `jsonVariation` returns the whole value. | ❌ code-change note (PLAN §10.5); rule values are not merged with the default in StatSig either. | `checkout_params` param store |
| 10.8 | Name shared with a gate | Separate namespaces. | One key space. | 📅 `key_collision` (1.2). | `maintenance_mode` |
| 10.9 | Custom unit type configs | `idType: companyID`. | Rollouts by that context kind. | 📅 as for gates. | `b2b_order_limits` |

## 11. Experiments, layers, holdouts, autotune (M6/M7; PLAN §11)

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 11.1 | Running experiment | `active`. | Can't move assignments mid-flight. | 📅 `experiment_running` (wait, or pre-stage a draft). | `search_ranking_v3`, `checkout_cta_copy` |
| 11.2 | Concluded experiment | `decision_made` + `launchedGroupID`. | Flag serving the shipped group at 100 %. | 📅 `experiment_concluded`. | `homepage_layout_test`; `search_ranking_v3` in snapshot 2 |
| 11.3 | Not started / abandoned / archived | `setup` / `abandoned` / `archived`. | Draft / skip / skip. | 📅. Archived experiments are absent from specs. | `checkout_button_color`, `free_shipping_banner`, `old_banner_test` |
| 11.4 | Custom randomization unit | `idType: companyID`. | Experiment on the `company` context kind. | 📅. | `b2b_discount_tiers` |
| 11.5 | Targeting gate | `targetingGateID`. | Audience = flag targeting rules. | 📅 inline or prerequisite as in §7. | `search_ranking_v3` → `checkout_targeting_gate` |
| 11.6 | Explicit layer with shared parameters | `getLayer().get()`. | LD layers; one flag per experiment. | 📅 `layer_parameters`. Implicit layers are dropped. | `checkout_layer`; `checkout_button_color_layer` (implicit) |
| 11.7 | Holdouts | Global or attached to gates / experiments. | New holdout populations per environment. | 📅; see 4.8 for gates. | `global_holdout`, `checkout_holdout`, mobile `mobile_global_holdout` |
| 11.8 | Autotune | Bandit with a success event. | `type: mab` bandit, drafted. | 📅. | `promo_banner_autotune` |
| 11.9 | Group sizes | Percent of allocation; may be unequal. | Thousandths of a percent. | 📅 rounding as 4.11. | mobile `onboarding_carousel` (34/33/33) |

## 12. Metrics

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 12.1 | Cloud metric types | `event_count_custom`, `sum`, `mean`, `ratio`, `funnel`, `composite`. | Custom / numeric / ratio / funnel; no composite. | 📅 port `statsig-to-ld metrics convert`; `metric_unsupported` for composite. | `engagement_score` (composite) |
| 12.2 | Events need instrumentation | Events are logged to StatSig. | `track()` with the same event key. | ❌ instrumentation checklist. | `purchase`, `checkout_start` |
| 12.3 | Warehouse Native | Metric sources + SQL. | Data source must be created in the LD UI by an admin; custom and ratio only, no funnels; not on Federal. | 📅 guided checklist. | mobile `orders`, `app_sessions` |
| 12.4 | Metric identity | `name::type`; two metrics may share a name. | Unique metric keys. | 📅 key from name + type when needed. | `purchase_count` vs `revenue` share the `purchase` event |
| 12.5 | Metrics from a spec source | Not in the spec. | — | 📅 "needs Console key or manual definition". | spec upload |

## 13. Param stores

| # | Edge case | StatSig | LaunchDarkly | Handling | Demo example |
|---|---|---|---|---|---|
| 13.1 | Static, gate-, experiment- and config-backed parameters | One store, mixed references. | JSON flag for statics; references point at the migrated flags. | 📅 MANUAL → PARTIAL (PLAN §6); code-change notes. | `checkout_params` |
| 13.2 | Spec v1 | No param stores in v1. | — | 📅 needs v2 or the Console API. | generated v1 spec |

## 14. Source differences (Console API vs config spec)

| # | Edge case | Console API | Config spec | Handling | Demo example |
|---|---|---|---|---|---|
| 14.1 | Metadata | Names, descriptions, tags, owners, timestamps, lifecycle, checks, archived. | Only `version`; rule names are opaque IDs. | 📅 enrichment CSV; `completeness.missing` drives "needs Console key" labels. | spec upload |
| 14.2 | Archived entities | Returned with `includeArchived=true`. | Absent. | 📝 an archive looks like a *removal* on re-upload. | `legacy_browser_banner` in snapshot 2 |
| 14.3 | ID lists | Plaintext. | Hashed, behind `get_id_lists`. | ✅ 9.4. | `wholesale_partners` |
| 14.4 | Environment scoping | `rule.environments`. | `environment_tier` conditions; environment list inferred and confirmed by the user. | ⚙️ 2.2. | all environment-scoped rules |
| 14.5 | Operators only the spec has | Enum lacks `eq`, `neq`, `version_neq`, `str_starts_with_any`, `str_ends_with_any`, `in_segment_list`. | All present in real specs. | ⚙️ covered by mapper tests; they can't appear in the Console-API demo. | — (test only) |
| 14.6 | Salts | Not exposed. | Present. | 📅 exact parity tester (PLAN §17). | — |
| 14.7 | `country` provenance | Unknown (5.2). | `ip_based` vs `user_field`. | 📝. | — |
| 14.8 | Partial files | — | A key scoped to an environment or target app yields a partial spec. | ✅ warning on upload. | — |
| 14.9 | Wrong file | — | Protobuf+brotli, or a client `initialize` response. | ✅ rejected with instructions. | reference fixtures |
| 14.10 | Browser access | 401/429 responses carry no CORS header (look like network errors); 200 responses unverified (M0 spike #1). | CDN 200 responses unverified. | ✅ `StatsigUnreachableError` after backoff; ❓ `docs/TODO-m0-spike-1-statsig-cors.md`. | demo mock injects 429s |

## 15. LaunchDarkly platform and API quirks that shape the mapping

| # | Quirk | Consequence | Handling |
|---|---|---|---|
| 15.1 | A clause on a missing attribute never matches, even negated. | Drives 6.3 and 6.4. | ✅ decisions. |
| 15.2 | Prerequisites are evaluated before individual targets. | Drives 7.3. | 📝 partial. |
| 15.3 | Regex is evaluated by each SDK's engine. | Drives 6.9. | ✅ `regex_dialect`. |
| 15.4 | SemVer operators need valid semver. | Drives 6.7. | 🚧. |
| 15.5 | List segments hold at most 15 000 IDs (`LIST_SEGMENT_MAX`). | Drives 9.3. | ✅ `big_segment`. ❓ confirm the current limit. |
| 15.6 | Prerequisites, big segments, scheduled changes, approvals, holdouts, layers are plan-gated. | Options appear only when the capability probe allows them. | ✅ capability matrix (PLAN §5.2). |
| 15.7 | Custom-property and environment instructions can't share a semantic patch; rapid writes to one flag return 429. | Two PATCHes per flag; backoff. | ⚙️ executor (reference/README). |
| 15.8 | Deleting a prerequisite flag or a targeted segment returns 409. | Undo must order deletes. | ⚙️ executor. |
| 15.9 | No `Access-Control-Expose-Headers`. | The browser can't read `X-Ratelimit-*` / `Retry-After`. | ⚙️ adaptive backoff. |
| 15.10 | A flag is created in every environment at once. | Unmigrated environments exist, off. | ⚙️ 2.5. |
| 15.11 | Keys: letters, digits, `.`, `_`, `-`; tags ≤ 64 of the same. | Drives 1.1 and 1.4. | ⚙️ + 📝. |

## 16. Consolidation (N StatSig projects → 1 LD project; M8)

| # | Edge case | Handling | Demo example |
|---|---|---|---|
| 16.1 | Same name, identical targeting | 📅 auto-merge; provenance lists both sources. | `employees_only`, `maintenance_mode`, `kill_switch_payments` |
| 16.2 | Same name, different targeting | 📅 `source_collision`: prefix both (`web.x`, `mobile.x`), primary wins, pick a source, or a discriminator flag. Renames propagate to `segmentMatch`, prerequisites and inlined references. | `new_checkout_flow`, `dark_mode`, `search_v2` |
| 16.3 | Shared segment name, different rules | 📅 as 16.2. | `beta_testers` |
| 16.4 | Shared event across sources | 📅 confirm once per event that it means the same thing. | `purchase` |
| 16.5 | Unit types with the same name | 📅 merged by name; decision if their meaning differs. Also 3.2 within one source. | `companyID` in both |
| 16.6 | Same key from both sources today | ⚙️ refused (DEMO.md). | — |

---

## 17. Mapper backlog (every 🚧 above, in priority order)

1. **Holdouts on gates are ignored** (4.8): held-out users get the feature in LD. Add a `holdout_attached` acknowledgement with the share, or create an LD holdout.
2. **Numeric typing** (6.2, 6.5, 6.6, 6.10): StatSig stringifies and coerces, LD compares typed values. Keep numeric targets typed where the attribute is numeric, and add a `value_type` decision when a target list mixes types or when the attribute type is unknown.
3. **Version strings that aren't semver** (6.7): detect 4-part and prerelease targets and raise a decision (rewrite the target, or acknowledge the mismatch).
4. **Custom-ID overrides on a userID gate** (3.4): ask which unit type, instead of inventing a `custom` kind.
5. **Two unit types defaulting to one context kind** (3.2): warn in the mapping profile.
6. **Prerequisite cycles** (7.8): make the mapper decision blocking instead of relying on the planner error.
7. **Sanitized-key collisions between StatSig names** (1.1) and **tag merges by lower-casing** (1.4).
8. **Dates** (5.3, 6.8): `on` in UTC vs local day; attribute values in epoch seconds; add to the context contract.
9. **Context contract** (3.5, 5.8, 5.9, 6.6): generate the document PLAN §10.5 promises, so the attribute-name, type and multi-context requirements collected above reach developers.
10. **`maintainer_unknown`** (1.5) and `analysis_list` / `user_store_id_list` segments (9.10), override-list size (8.5).
