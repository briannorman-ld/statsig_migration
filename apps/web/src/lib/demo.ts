/**
 * Demo mode (PLAN §19). The StatSig side is simulated by MSW *behind* the real Console API
 * adapter: a demo source is an ordinary Console API source whose base URL points at a
 * same-origin path the service worker intercepts. Loaded lazily so non-demo users never fetch
 * the dataset or the mock.
 */
import type { SourceDescriptor } from '@sslm/canonical';
import { store } from './store.ts';

export const DEMO_WORKSPACE_ID = 'demo-acme-retail';
export const DEMO_TAG = 'statsig-migration-demo';
/**
 * The LD project the demo targets: an existing project chosen by the user (not one the demo
 * created). It is not tagged `statsig-migration-demo`, so PLAN §19.3 "Reset demo" must never
 * delete anything in it beyond resources carrying our own provenance.
 */
export const DEMO_LD_PROJECT = { instance: 'us' as const, projectKey: 'statsig-migration' };

/**
 * The demo LD project has only `test` and `production`, so StatSig `staging` is pre-mapped to
 * `test` (editable under Mapping). `development` and `qa` stay unmapped, to show that state.
 */
export const DEMO_ENV_HINTS: Record<string, string> = { staging: 'test' };

let started: Promise<void> | undefined;
let demoSnapshot = 1;

/** Current position on the scripted StatSig timeline (PLAN §19.3). */
export function demoTimeline() {
  return demoSnapshot;
}

export function startDemoMock(): Promise<void> {
  started ??= (async () => {
    const [{ setupWorker }, fixtures, data] = await Promise.all([
      import('msw/browser'),
      import('@sslm/demo-fixtures'),
      import('@sslm/demo-fixtures/data/acme-retail.json'),
    ]);
    const file = (data as unknown as { default: import('@sslm/demo-fixtures').AcmeRetailFile }).default;
    const worker = setupWorker(
      ...fixtures.createAcmeDemoHandlers({
        origin: location.origin,
        getDataset: (alias) => file.projects[alias][demoSnapshot - 1]!,
        // Occasional 429s so the adaptive backoff is visible (PLAN §19.1). Browser-realistic:
        // StatSig's 429s carry no CORS header, so they surface as network errors.
        throttleRate: 0.06,
        browserCors: true,
        latencyMs: 40,
      }),
    );
    await worker.start({ serviceWorker: { url: '/mockServiceWorker.js' }, onUnhandledFrame: 'bypass', quiet: true });
  })();
  return started;
}

export async function demoKey(): Promise<string> {
  return (await import('@sslm/demo-fixtures')).DEMO_STATSIG_API_KEY;
}

/** Create (or reuse) the "Acme Retail (Demo)" workspace with both demo sources preconnected. */
export async function ensureDemoWorkspace(): Promise<string> {
  const { demoStatsigBaseUrl } = await import('@sslm/demo-fixtures');
  const existing = await store.getWorkspace(DEMO_WORKSPACE_ID);
  if (!existing) await store.createWorkspace({ id: DEMO_WORKSPACE_ID, name: 'Acme Retail (Demo)', isDemo: true, ld: DEMO_LD_PROJECT });
  else if (!existing.ld?.projectKey) await store.updateWorkspace(DEMO_WORKSPACE_ID, { ld: DEMO_LD_PROJECT });
  const have = new Set((await store.listSources(DEMO_WORKSPACE_ID)).map((s) => s.id));
  const sources: SourceDescriptor[] = (['web', 'mobile'] as const).map((alias, i) => ({
    id: `${DEMO_WORKSPACE_ID}-${alias}`,
    alias,
    label: `acme-${alias}`,
    kind: 'console_api',
    baseUrl: demoStatsigBaseUrl(location.origin, alias),
    isDemo: true,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  }));
  for (const s of sources) if (!have.has(s.id)) await store.addSource(DEMO_WORKSPACE_ID, s);
  return DEMO_WORKSPACE_ID;
}
