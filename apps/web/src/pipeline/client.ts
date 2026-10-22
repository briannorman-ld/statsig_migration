import type { CanonicalSnapshot, EntityKind } from '@sslm/canonical';
import type { CrawlProgress } from '@sslm/adapters';
import type { PipelineEvent, PipelineRequest, PipelineSource } from './protocol.ts';

type Pending = {
  resolve: (r: { snapshot: CanonicalSnapshot; spec?: { version: 1 | 2; json: unknown; bytes: number } }) => void;
  reject: (e: PipelineError) => void;
  onProgress?: (p: CrawlProgress) => void;
  onTransport?: (e: Extract<PipelineEvent, { type: 'transport' }>['event']) => void;
};

export class PipelineError extends Error {
  constructor(readonly code: 'auth' | 'rejected' | 'aborted' | 'failed', message: string) {
    super(message);
    this.name = 'PipelineError';
  }
}

type RequestBody<R> = R extends { id: number } ? Omit<R, 'id'> : never;

/** Main-thread handle to the pipeline worker. */
export class Pipeline {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'pipeline' });
    this.worker.onmessage = (ev: MessageEvent<PipelineEvent>) => {
      const e = ev.data;
      const p = this.pending.get(e.id);
      if (!p) return;
      if (e.type === 'progress') p.onProgress?.(e.progress);
      else if (e.type === 'transport') p.onTransport?.(e.event);
      else if (e.type === 'result') {
        this.pending.delete(e.id);
        p.resolve({ snapshot: e.snapshot, ...(e.spec ? { spec: e.spec } : {}) });
      } else {
        this.pending.delete(e.id);
        p.reject(new PipelineError(e.code, e.message));
      }
    };
  }

  crawlConsole(args: { source: PipelineSource; baseUrl: string; apiKey: string; kinds?: EntityKind[] }, handlers: Omit<Pending, 'resolve' | 'reject'> = {}) {
    return this.send({ type: 'crawl-console', ...args }, handlers);
  }

  parseSpec(args: { source: PipelineSource; bytes: ArrayBuffer; filename: string }, handlers: Omit<Pending, 'resolve' | 'reject'> = {}) {
    return this.send({ type: 'parse-spec', ...args }, handlers, [args.bytes]);
  }

  private send(body: RequestBody<PipelineRequest>, handlers: Omit<Pending, 'resolve' | 'reject'>, transfer: Transferable[] = []) {
    const id = this.nextId++;
    const promise = new Promise<{ snapshot: CanonicalSnapshot; spec?: { version: 1 | 2; json: unknown; bytes: number } }>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, ...handlers });
    });
    this.worker.postMessage({ ...body, id } as PipelineRequest, transfer);
    return { id, promise, cancel: () => this.worker.postMessage({ id: this.nextId++, type: 'cancel', target: id } satisfies PipelineRequest) };
  }
}

let shared: Pipeline | undefined;
export const pipeline = () => (shared ??= new Pipeline());
