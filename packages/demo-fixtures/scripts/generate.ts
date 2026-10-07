/**
 * Regenerates the committed demo fixtures from the TypeScript seed:
 *   data/acme-retail.json        Console API dataset, both projects × all snapshots (versioned)
 *   generated/…                  sample config specs, ID-list files and raw-ID CSV (PLAN §19.1)
 * Run: pnpm fixtures:generate. A test fails if the committed files are stale.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureFiles } from '../src/files.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const [rel, content] of Object.entries(buildFixtureFiles())) {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`wrote ${rel} (${(content.length / 1024).toFixed(1)} KB)`);
}
