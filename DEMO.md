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
4. **Gates**: 51 gates side by side, per StatSig environment (top-right selector). Each row shows
   the fidelity, open decisions, and a per-environment status strip read from LD provenance
   (`test ● production ○`). Click a row for the rules diff: StatSig rules for that environment on
   the left, the generated LD targeting on the right, plus fidelity notes and the row's decisions.
5. **Decisions** (left nav): ~110 decisions grouped by type and by identical question, e.g.
   *Case-insensitive match — 26 decisions in 22 items*, or *Client-side availability — 51*.
   Resolve one group with one click, **Save as policy**, or **Use recommended for N choices**.
   Blocking decisions (20k-ID `fraud_blocklist`, `is_null`, `url`/`target_app` conditions) and
   acknowledgements (re-bucketing, missing-attribute semantics) always need an explicit answer.
   **Export log** gives the decision log as Markdown or CSV.
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
8. Spec-only path: *Add source → Upload config spec* with
   `packages/demo-fixtures/generated/acme-web/download_config_specs.v2.json`. Uploading the same
   file again is detected as a duplicate; `…snapshot-2.json` produces a diff.

Not yet: dynamic configs, big segments and approval requests (M4); drift monitoring and waves
(M5); consolidation of identical gates across `acme-web` and `acme-mobile` (M8). Migrating the same
gate name from both sources is refused for now.
