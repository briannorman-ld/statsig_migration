import { describe, expect, it } from 'vitest';
import { flagStatusKey, FlagStatusesSchema } from '../src/schemas.ts';

describe('flag statuses', () => {
  it('parses FlagStatusRep items leniently and reads the flag key from the links', () => {
    const page = FlagStatusesSchema.parse({
      _links: { self: { href: '/api/v2/flag-statuses/p/test', type: 'application/json' } },
      items: [
        { name: 'active', lastRequested: '2026-10-23T11:00:00.000Z', default: false, _links: { parent: { href: '/api/v2/flags/p/new_checkout_flow', type: 'application/json' }, self: { href: '/api/v2/flag-statuses/p/test/new_checkout_flow' } }, extra: 1 },
        { name: 'new', _links: { self: { href: '/api/v2/flag-statuses/p/test/with%20space' } } },
        { name: 'inactive' },
      ],
    });
    expect(page.items?.map((i) => flagStatusKey(i))).toEqual(['new_checkout_flow', 'with space', undefined]);
  });
});
