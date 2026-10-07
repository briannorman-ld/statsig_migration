# Demo walkthrough (as of M1)

The full 10–15 minute script (PLAN §19.5) needs M3+. What can be shown today:

1. `pnpm dev`, open http://localhost:5173, click **Try the demo**. Two StatSig projects,
   `acme-web` (Cloud) and `acme-mobile` (Warehouse Native), sync through the *real* Console API
   adapter in a Web Worker. The StatSig side is an in-browser MSW mock that injects occasional
   429s the way a browser sees them (network errors, no status): watch the retry messages.
2. **Gates**: 51 gates side by side, per environment (top-right selector). Switch to `qa` and
   `qa_debug_panel` goes from 0 rules to 1; `staging` adds the staging-only override on `new_checkout_flow`. Click a row
   for the raw resolved rules. Shared names are badged “in 2 sources” (consolidation, M8).
3. **Source warnings**: the 20k-ID `fraud_blocklist` and 2.5k `wholesale_partners` lists are deferred
   (fetched on demand when migrating big segments, M4).
4. **LaunchDarkly & capabilities**: paste a token (memory only). The demo targets the existing
   `statsig-migration` project on the US instance, which is selected and probed automatically
   (read-only) to fill the capability matrix. The gates grid then shows whether each key exists in
   LD and its on/off state. That project has `test` and `production`, so only `production` matches
   a StatSig tier until environment mapping lands (M3). EU/Federal show their acknowledgement.
5. Spec-only path: *Add source → Upload config spec* with
   `packages/demo-fixtures/generated/acme-web/download_config_specs.v2.json`. Uploading the same
   file again is detected as a duplicate; `…snapshot-2.json` produces a diff.
