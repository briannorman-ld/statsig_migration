import type { CanonicalSnapshot, EntityKind } from '@sslm/canonical';
import type { CrawlProgress } from '@sslm/adapters';
import type { TransportEvent } from '@sslm/http';

export interface PipelineSource {
  sourceId: string;
  alias: string;
}

/** Requests to the pipeline worker. Keys are passed per call and held only in worker memory. */
export type PipelineRequest =
  | { id: number; type: 'crawl-console'; source: PipelineSource; baseUrl: string; apiKey: string; eagerIdListMax?: number; kinds?: EntityKind[] }
  | { id: number; type: 'parse-spec'; source: PipelineSource; bytes: ArrayBuffer; filename: string }
  | { id: number; type: 'cancel'; target: number };

export type PipelineEvent =
  | { id: number; type: 'progress'; progress: CrawlProgress }
  /** Transport events (requests, responses, retries, throttling) for the progress UI. Carry no headers or bodies. */
  | { id: number; type: 'transport'; event: TransportEvent }
  | { id: number; type: 'result'; snapshot: CanonicalSnapshot; spec?: { version: 1 | 2; json: unknown; bytes: number } }
  | { id: number; type: 'error'; code: 'auth' | 'rejected' | 'aborted' | 'failed'; message: string };
