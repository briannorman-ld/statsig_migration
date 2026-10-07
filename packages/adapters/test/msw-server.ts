import { setupServer } from 'msw/node';
import { buildAcmeDataset, createStatsigConsoleHandlers, DEMO_STATSIG_API_KEY, type AcmeAlias, type ConsoleProjectDataset, type MockStatsigOptions } from '@sslm/demo-fixtures';
import { StatsigConsoleClient, type SchemaIssue } from '@sslm/statsig-client';

export const TEST_BASE = (alias: string) => `https://demo-statsig.test/${alias}/console/v1`;

export const server = setupServer();

export function mockProject(alias: AcmeAlias, opts: Partial<MockStatsigOptions> & { dataset?: ConsoleProjectDataset } = {}) {
  const dataset = opts.dataset ?? buildAcmeDataset(alias, 1);
  server.use(...createStatsigConsoleHandlers({ baseUrl: TEST_BASE(alias), getDataset: () => dataset, apiKey: DEMO_STATSIG_API_KEY, ...opts }));
  return dataset;
}

/** A client with fast retries and no rate budget, so tests don't wait on real time windows. */
export function testClient(alias: string, opts: { apiKey?: string; pageSize?: number; maxAttempts?: number } = {}) {
  const issues: SchemaIssue[] = [];
  const client = new StatsigConsoleClient({
    baseUrl: TEST_BASE(alias),
    apiKey: opts.apiKey ?? DEMO_STATSIG_API_KEY,
    pageSize: opts.pageSize,
    onSchemaIssue: (i) => issues.push(i),
    transport: { budgets: [], retry: { baseDelayMs: 1, maxDelayMs: 5, maxAttempts: opts.maxAttempts ?? 6 } },
  });
  return { client, issues };
}
