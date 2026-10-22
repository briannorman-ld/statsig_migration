import { checkUpload, type CanonicalSnapshot, type SourceDescriptor } from '@sslm/canonical';
import { crawlConsoleProject, normalizeConsoleSnapshot, type CrawlProgress } from '@sslm/adapters';
import { StatsigConsoleClient, type SchemaIssue } from '@sslm/statsig-client';
import { pipeline } from '../pipeline/client.ts';
import { demoKey, startDemoMock } from './demo.ts';
import { secrets } from './secrets.ts';
import { store } from './store.ts';

export interface SyncHandlers {
  onProgress?: (p: CrawlProgress) => void;
  onRetry?: (message: string) => void;
}

/** Re-crawl a Console API source and save a new immutable snapshot. */
export async function syncConsoleSource(workspaceId: string, source: SourceDescriptor, h: SyncHandlers = {}): Promise<CanonicalSnapshot> {
  if (source.kind !== 'console_api' || !source.baseUrl) throw new Error('Not a Console API source.');
  let apiKey: string | undefined;
  if (source.isDemo) {
    await startDemoMock();
    apiKey = await demoKey();
  } else {
    apiKey = secrets.get('statsig', source.id);
  }
  if (!apiKey) throw new Error('Enter the Console API key for this source (keys are kept in memory only).');
  const onRetry = (url: string, delayMs: number, reason: string) =>
    h.onRetry?.(`Retrying ${new URL(url, location.href).pathname.split('/console/v1')[1] ?? url} in ${Math.round(delayMs / 100) / 10}s (${reason})`);
  if (source.isDemo) {
    // The demo's MSW mock reliably intercepts only this page's own requests: after a reload, the
    // service worker doesn't serve requests from the pipeline worker. So demo sources crawl on the
    // main thread, through the same adapters; the dataset is small.
    const issues: SchemaIssue[] = [];
    const client = new StatsigConsoleClient({ baseUrl: source.baseUrl, apiKey, onSchemaIssue: (i) => issues.push(i), transport: { onEvent: (e) => e.type === 'retry' && onRetry(e.url, e.delayMs, e.reason) } });
    const raw = await crawlConsoleProject(client, issues, { onProgress: h.onProgress });
    const snapshot = normalizeConsoleSnapshot(raw, { source: { sourceId: source.id, sourceKind: 'console_api', alias: source.alias } });
    await store.saveSnapshot(workspaceId, snapshot);
    return snapshot;
  }
  const job = pipeline().crawlConsole(
    { source: { sourceId: source.id, alias: source.alias }, baseUrl: source.baseUrl, apiKey },
    {
      onProgress: h.onProgress,
      onTransport: (e) => {
        if (e.type === 'retry') onRetry(e.url, e.delayMs, e.reason);
      },
    },
  );
  const { snapshot } = await job.promise;
  await store.saveSnapshot(workspaceId, snapshot);
  return snapshot;
}

/** Upload a config spec for a spec source: parse in the worker, sanity-check, save. */
export async function uploadSpec(workspaceId: string, source: SourceDescriptor, file: File) {
  const bytes = await file.arrayBuffer();
  const { snapshot, spec } = await pipeline().parseSpec({ source: { sourceId: source.id, alias: source.alias }, bytes, filename: file.name }).promise;
  const prev = (await store.latestSnapshot(source.id))?.canonical;
  const sanity = checkUpload(prev, snapshot);
  if (sanity.companyMismatch) {
    throw new Error(`This spec belongs to a different StatSig project (company ${sanity.companyMismatch.next}, previously ${sanity.companyMismatch.previous}).`);
  }
  if (sanity.duplicate) return { snapshot, sanity, saved: false };
  const rec = await store.saveSnapshot(workspaceId, snapshot);
  if (spec) await store.saveSpecUpload({ workspaceId, sourceId: source.id, filename: file.name, bytes: spec.bytes, version: spec.version, json: spec.json, snapshotId: rec.id });
  if (!source.companyId && snapshot.companyId) await store.addSource(workspaceId, { ...source, companyId: snapshot.companyId });
  return { snapshot, sanity, saved: true };
}
