import type { HttpHandler } from 'msw';
import { ACME_PROJECTS, type AcmeAlias } from '../acme/index.ts';
import type { ConsoleProjectDataset } from '../console/dataset.ts';
import { createStatsigConsoleHandlers, type MockStatsigOptions } from './statsig-console.ts';

/** A dummy Console key for demo sources. The mock checks it so the auth path is exercised. */
export const DEMO_STATSIG_API_KEY = 'console-DEMO-acme-retail-not-a-real-key';

/**
 * Same-origin path, so the strict CSP (`connect-src 'self' …`) needs no extra host for the demo.
 * `root` is the app's origin plus any base path (GitHub Pages serves under /<repo>/), which also
 * keeps the URL inside the mock service worker's scope.
 */
export function demoStatsigBaseUrl(root: string, alias: AcmeAlias): string {
  return `${root.replace(/\/+$/, '')}/__demo/statsig/${alias}/console/v1`;
}

export interface DemoHandlerOptions extends Omit<MockStatsigOptions, 'baseUrl' | 'getDataset' | 'apiKey'> {
  origin: string;
  getDataset: (alias: AcmeAlias) => ConsoleProjectDataset;
}

/** Handlers for both Acme demo projects. */
export function createAcmeDemoHandlers(opts: DemoHandlerOptions): HttpHandler[] {
  const { origin, getDataset, ...rest } = opts;
  return (Object.keys(ACME_PROJECTS) as AcmeAlias[]).flatMap((alias, i) =>
    createStatsigConsoleHandlers({
      ...rest,
      seed: (rest.seed ?? 42) + i,
      baseUrl: demoStatsigBaseUrl(origin, alias),
      apiKey: DEMO_STATSIG_API_KEY,
      getDataset: () => getDataset(alias),
    }),
  );
}
