# Demo walkthrough (as of M3 for gates)

The full 10–15 minute script (PLAN §19.5) grows with each milestone. What can be shown today:

1. `pnpm dev`, open http://localhost:5173, click **Try the demo**. Two StatSig projects,
   `acme-web` (Cloud) and `acme-mobile` (Warehouse Native), sync through the *real* Console API
   adapter. The StatSig side is an in-browser MSW mock that injects occasional 429s the way a
   browser sees them (network errors, no status): watch the retry messages.
2. **LaunchDarkly & capabilities**: paste an LD token (memory only). The demo targets the existing
   `statsig-migration` project on the US instance, which is selected and probed automatically
   (read-only) to fill the capability matrix.
3. **Mapping**: the demo maps StatSig `staging → test` and `production → production`;
   `development` and `qa` stay *not migrated*. Unit types map to context kinds (`companyID` →
   `company`, created on first use).
4. **Gates**: 54 gates side by side, per StatSig environment (top-right selector). Each row shows
   the fidelity, open decisions, and a per-environment status strip read from LD provenance
   (`test ● production ○`). Click a row for the rules diff: StatSig rules for that environment on
   the left, the generated LD targeting on the right, plus fidelity notes and the row's decisions.
   **Dynamic configs** get the same explorer: `homepage_hero` (three variants → a 50/30/20 rollout
   across JSON variations), `api_rate_limits` (a 50 % rule: the rest get the default, nothing falls
   through) and `legacy_pricing_rules` (disabled; its rule value equals the default, so the flag has
   one variation). `maintenance_mode` exists as a gate *and* a config: planning both is refused.
5. **Decisions** (left nav): ~110 decisions grouped by type and by identical question, e.g.
   *Case-insensitive match — 26 decisions in 22 items*, or *Client-side availability — 51*.
   Resolve one group with one click, **Save as policy**, or **Use recommended for N choices**.
   Blocking decisions (20k-ID `fraud_blocklist`, `is_null`, `url`/`target_app` conditions, the
   deleted segment behind `referral_bonus`, the 12-rule expansion in `cross_sell_matrix`, the
   `encoded_any` allowlist, and the gate references in `express_pay_fallback`, `consumer_pricing`
   and `checkout_upsell_v2`) and acknowledgements (re-bucketing, missing-attribute semantics)
   always need an explicit answer. **Export log** gives the decision log as Markdown or CSV.
   Every row of `docs/KNOWN-EDGE-CASES.md` has a gate, segment or config here; the gate
   descriptions say which edge case each one is for.
6. **Migrate to staging only**: environment `staging`, select `new_checkout_flow`,
   `checkout_express_pay`, `b2b_bulk_ordering`, `wholesale_portal` → **Plan migration…**. The plan
   pulls in `beta_testers` and `wholesale_partners` (its 2,500 IDs are fetched on demand), the
   `company` context kind, and orders `new_checkout_flow` before `checkout_express_pay` (its
   prerequisite). Acknowledge the 20% re-bucketing inline, **Dry run** (LD validates, nothing is
   saved), then **Migrate**. Production stays untouched (off). Open LD to see the flags, the
   `statsig-migrated` / `statsig-src-web` tags, the `statsig.*` custom properties and the audit-log
   comments naming the run.
7. **Runs**: every run and dry run is journaled. **Undo…** deletes what a run created and restores
   what it updated. A run interrupted by closing the tab shows a banner and can be resumed.
   Production migrations need a typed confirmation.
8. **Edge-case tour** (optional, 3 minutes): `non_staff_survey` (a negated gate reference,
   inlined exactly) next to `express_pay_fallback` (the same shape, not inlinable); `reviews_v2`
   (a 0% rule is an exclusion); `free_returns` (unreachable rules dropped); `Holiday Banner 2026`
   (key sanitized); `loyalty_tier_perks` (numeric `any` values: a known gap, see the doc);
   `anon_homepage_variant` (stableID → `device` context kind); segments `churn_risk` (10% rule),
   `staff_or_beta` (gate inlined into a segment) and `early_adopters` (cannot inline, so
   `early_adopter_badge` is blocked in the plan). In snapshot 2, `legacy_browser_banner` is
   archived, `bot_detection_challenge` is switched off and `checkout_gift_wrap` appears.
9. Spec-only path: *Add source → Upload config spec* with
   `packages/demo-fixtures/generated/acme-web/download_config_specs.v2.json`. Uploading the same
   file again is detected as a duplicate; `…snapshot-2.json` produces a diff.

10. **What migrates** (left nav, under Migration): the full coverage matrix with the demo inventory counted
    against it, filterable by status. Experiments, layers, holdouts, metrics and param stores in the
    resource lists carry the same per-item verdict (*running in StatSig*, *draft (planned)*, *no
    equivalent*, …) with a "why?" link into the matrix. The same data is published as
    [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

M4 in the demo: `fraud_blocklist` (20k IDs) loads from Source warnings and migrates as a big
segment; the spec-only `wholesale_partners` list reconciles against
`generated/acme-web/wholesale_partners.raw-ids.csv` (99.6 % coverage → a `hashed_id_list`
acknowledgement); `black_friday_2027` offers an LD scheduled change. The demo LD project has no
approval-required environment, so the approval-request fallback only shows in the Runs page when
LD answers a write with 405.

Not yet: drift monitoring and waves (M5); consolidation of identical gates across `acme-web` and
`acme-mobile` (M8). Migrating the same gate name from both sources is refused for now.
