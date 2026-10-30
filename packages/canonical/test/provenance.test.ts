import { describe, expect, it } from 'vitest';
import { footer, hasMigratedTag, hasSourceTag, migratedFromTag, parseFooter, readFlagProvenance, readSync, sourceKindOf, sourceTag, syncedEnvsOf, withFooter } from '../src/provenance.ts';

describe('provenance scheme (PLAN §3.3)', () => {
  it('names tags by source kind and attached source', () => {
    expect(migratedFromTag('statsig')).toBe('migrated-from-statsig');
    expect(sourceTag('Web App')).toBe('migration-src-web-app');
    expect(hasMigratedTag(['platform', 'migrated-from-statsig'])).toBe(true);
    expect(hasMigratedTag(['statsig-migrated'])).toBe(true);
    expect(hasMigratedTag(['platform'])).toBe(false);
    expect(hasSourceTag(['migration-src-web'], 'web')).toBe(true);
    expect(hasSourceTag(['statsig-src-web'], 'web')).toBe(true);
    expect(sourceKindOf(['statsig-migrated'])).toBe('statsig');
    expect(sourceKindOf(['migrated-from-statsig'])).toBe('statsig');
    expect(sourceKindOf(['x'])).toBeUndefined();
  });

  it('reads flag provenance from current keys, legacy keys, or a mix', () => {
    const current = { tags: ['migrated-from-statsig'], customProperties: { 'migration.kind': { value: ['statsig'] }, 'migration.id': { value: ['g'] }, 'migration.source': { value: ['web'] }, 'migration.type': { value: ['gate'] } } };
    expect(readFlagProvenance(current)).toEqual({ kind: 'statsig', id: 'g', source: 'web', type: 'gate' });
    const legacy = { tags: ['statsig-migrated'], customProperties: { 'statsig.id': { value: ['g'] }, 'statsig.source': { value: ['web'] } } };
    expect(readFlagProvenance(legacy)).toEqual({ kind: 'statsig', id: 'g', source: 'web' });
    expect(readFlagProvenance({ tags: [], customProperties: current.customProperties })).toBeNull();
    expect(readFlagProvenance({ tags: ['migrated-from-statsig'], customProperties: {} })).toBeNull();
  });

  it('reads sync records under both prefixes and prefers the current one', () => {
    const props = { 'statsig.sync.test': { value: ['old'] }, 'migration.sync.test': { value: ['new'] }, 'statsig.sync.production': { value: ['p'] }, 'migration.sync.qa': { value: [] } };
    expect(readSync(props, 'test')).toEqual(['new']);
    expect(readSync(props, 'production')).toEqual(['p']);
    expect(readSync(props, 'qa')).toBeUndefined();
    expect(syncedEnvsOf(props).sort()).toEqual(['production', 'test']);
  });

  it('writes a footer that names the source kind and replaces current or legacy footers', () => {
    const f = footer({ kind: 'statsig', sourceAlias: 'web', sourceId: 'vip', sourceFingerprint: 'fp1', decisionSetHash: 'd1' }, new Date('2026-10-30T00:00:00Z'));
    expect(f).toBe('[ld-migration: from=statsig; src=web; id=vip; fp=fp1; d=d1; at=2026-10-30T00:00:00.000Z]');
    expect(withFooter('VIPs', f)).toBe(`VIPs\n\n${f}`);
    expect(withFooter(`VIPs\n\n[statsig-migration: src=web; id=vip; fp=fp0; d=d0; at=x]`, f)).toBe(`VIPs\n\n${f}`);
    expect(parseFooter(f)).toEqual({ from: 'statsig', src: 'web', id: 'vip', fp: 'fp1', d: 'd1', at: '2026-10-30T00:00:00.000Z' });
    expect(parseFooter('[statsig-migration: src=web; id=vip; fp=fp0; d=d0; at=x]')).toEqual({ from: 'statsig', src: 'web', id: 'vip', fp: 'fp0', d: 'd0', at: 'x' });
    expect(parseFooter('plain')).toBeNull();
  });
});
