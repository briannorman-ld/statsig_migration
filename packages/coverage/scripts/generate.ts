/**
 * Rewrites the generated coverage block in docs/LIMITATIONS.md from packages/coverage/src/matrix.ts.
 * Run: pnpm coverage:generate. A test fails if the committed block is stale.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spliceCoverageBlock } from '../src/markdown.ts';

const doc = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'LIMITATIONS.md');
const before = readFileSync(doc, 'utf8');
const after = spliceCoverageBlock(before);
writeFileSync(doc, after);
console.log(after === before ? `docs/LIMITATIONS.md already up to date` : `wrote docs/LIMITATIONS.md`);
