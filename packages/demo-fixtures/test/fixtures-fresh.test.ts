import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildFixtureFiles } from '../src/files.ts';

describe('committed fixture files', () => {
  it.each(Object.entries(buildFixtureFiles()))('%s is up to date (run `pnpm fixtures:generate`)', (rel, content) => {
    const onDisk = readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
    expect(onDisk === content).toBe(true);
  });
});
