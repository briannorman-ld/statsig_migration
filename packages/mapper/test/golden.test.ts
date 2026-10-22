import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CanonicalSnapshot } from '@sslm/canonical';
import { mapGate, mapSegment } from '../src/index.ts';
import { acmeSnapshot, CAPS, NOW, profileFor, server } from './fixtures.ts';

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());

/**
 * Golden files (CLAUDE.md): canonical demo input + default profile + no resolutions → the desired
 * LD state and the decisions it raises, per environment. Review diffs in test/golden/ carefully:
 * a change there is a change in what lands in customers' LD projects.
 */
const MAPPING = { development: null, staging: 'test', production: 'production', qa: null };

function golden(snap: CanonicalSnapshot, statsig: string, ld: string) {
  const profile = profileFor(snap, MAPPING);
  const args = { canonical: { snapshot: snap }, profile, resolutions: new Map(), capabilities: CAPS, env: { statsig, ld }, now: NOW };
  const gates = snap.gates.map((g) => {
    const r = mapGate({ ...args, entity: g });
    return {
      gate: g.id,
      flagKey: r.flagKey,
      ...(r.skipped ? { skipped: r.skipped } : {}),
      fidelity: r.fidelity.overall,
      notes: r.fidelity.notes.map((n) => `${n.fidelity}: ${n.message}${n.location ? ` [${n.location}]` : ''}`),
      decisions: r.unresolved.map((d) => `${d.severity} ${d.type} (${d.subject.location ?? d.subject.id}) → ${d.recommended ?? 'no default'}`),
      dependencies: r.dependencies.map((d) => `${d.kind}:${d.key}`),
      env: r.skipped ? undefined : r.env,
    };
  });
  const segments = snap.segments.map((s) => {
    const r = mapSegment({ ...args, entity: s });
    return {
      segment: s.id,
      ...(r.skipped ? { skipped: r.skipped } : {}),
      fidelity: r.fidelity.overall,
      decisions: r.unresolved.map((d) => `${d.severity} ${d.type} (${d.subject.location ?? d.subject.id})`),
      rules: r.desired?.rules,
      included: r.desired?.included.length,
      includedContexts: r.desired?.includedContexts.map((c) => `${c.contextKind}: ${c.values.length}`),
    };
  });
  return { gates, segments };
}

describe('mapper golden files (acme-web)', () => {
  it.each([
    ['staging', 'test'],
    ['production', 'production'],
  ])('%s → LD %s', async (statsig, ld) => {
    const snap = await acmeSnapshot('web');
    await expect(JSON.stringify(golden(snap, statsig, ld), null, 2) + '\n').toMatchFileSnapshot(`golden/acme-web.${statsig}.json`);
  });
});
