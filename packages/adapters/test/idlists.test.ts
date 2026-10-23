import { describe, expect, it } from 'vitest';
import { buildAcmeDataset, buildRawIdCsv, generateConfigSpec } from '@sslm/demo-fixtures';
import { parseIdListFile, parseRawIdCsv, reconcileIdList, statsigIdListHash } from '../src/index.ts';

describe('ID-list reconciliation (PLAN §4.2)', () => {
  it('hashes like StatSig: first 8 chars of base64(sha256(id))', async () => {
    // node-js-server-sdk Hashing.ts; the demo's fixture generator uses a synchronous copy of the same function.
    expect(await statsigIdListHash('partner-00001')).toHaveLength(8);
    const files = generateConfigSpec(buildAcmeDataset('web', 1), 2);
    const file = files.idListFiles['wholesale_partners']!;
    const hashes = parseIdListFile(file);
    expect(hashes.has(await statsigIdListHash('partner-00001'))).toBe(true);
    expect(hashes.has(await statsigIdListHash('not-a-partner'))).toBe(false);
  });

  it('applies + and - lines in order, so a later file can remove an ID', () => {
    const set = parseIdListFile('+aaaaaaaa\n+bbbbbbbb\n');
    parseIdListFile('-aaaaaaaa\n+cccccccc\n', set);
    expect([...set].sort()).toEqual(['bbbbbbbb', 'cccccccc']);
  });

  it('reads the first CSV column, skips an id-like header, strips quotes and de-duplicates', () => {
    expect(parseRawIdCsv('user_id,email\n"u1",a@x\nu2,b@x\nu1,c@x\n\n')).toEqual(['u1', 'u2']);
    expect(parseRawIdCsv('u1\nu2\n')).toEqual(['u1', 'u2']);
  });

  it('reports coverage against the hashed list and leaves out IDs StatSig does not list', async () => {
    const dataset = buildAcmeDataset('web', 1);
    const files = generateConfigSpec(dataset, 2);
    const hashes = parseIdListFile(files.idListFiles['wholesale_partners']!);
    const raw = parseRawIdCsv(buildRawIdCsv(dataset, 'wholesale_partners', 0.996));
    const r = await reconcileIdList([...raw, 'stranger-1'], hashes, 2500);
    expect(r.coverage).toEqual({ total: 2500, matched: 2490, missing: 10, extra: 1, verified: true });
    expect(r.ids).toHaveLength(2490);
    expect(r.extra).toEqual(['stranger-1']);
  });

  it('without hashes it is count-based and unverified', async () => {
    const r = await reconcileIdList(['a', 'b', 'c', 'c'], undefined, 5);
    expect(r.ids).toEqual(['a', 'b', 'c']);
    expect(r.coverage).toEqual({ total: 5, matched: 3, missing: 2, extra: 0, verified: false });
  });
});
