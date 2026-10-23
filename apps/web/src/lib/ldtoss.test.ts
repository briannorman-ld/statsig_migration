import { afterEach, describe, expect, it } from 'vitest';
import { isLdTossEnabled, LDTOSS_KEY } from './ldtoss.ts';

describe('ldtoss gate', () => {
  afterEach(() => localStorage.removeItem(LDTOSS_KEY));

  it('is off unless the key is exactly "true"', () => {
    expect(isLdTossEnabled()).toBe(false);
    localStorage.setItem(LDTOSS_KEY, 'TRUE');
    expect(isLdTossEnabled()).toBe(false);
    localStorage.setItem(LDTOSS_KEY, '1');
    expect(isLdTossEnabled()).toBe(false);
    localStorage.setItem(LDTOSS_KEY, 'true');
    expect(isLdTossEnabled()).toBe(true);
  });

  it('treats blocked storage as off', () => {
    const blocked = {
      getItem(): string | null {
        throw new Error('blocked');
      },
    };
    expect(isLdTossEnabled(blocked)).toBe(false);
    expect(isLdTossEnabled(undefined)).toBe(false);
  });
});
