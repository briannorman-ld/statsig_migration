import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePager } from './Pager.tsx';

describe('usePager', () => {
  it('slices the current page and clamps navigation', () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    const { result } = renderHook(() => usePager(items, 50));
    expect(result.current).toMatchObject({ page: 0, pages: 3, total: 120, from: 1, to: 50 });
    expect(result.current.slice).toHaveLength(50);
    act(() => result.current.setPage(2));
    expect(result.current).toMatchObject({ page: 2, from: 101, to: 120 });
    expect(result.current.slice).toEqual(items.slice(100));
    act(() => result.current.setPage(9));
    expect(result.current.page).toBe(2);
  });

  it('goes back to the first page when the list changes size, and when the page size changes', () => {
    let items = Array.from({ length: 120 }, (_, i) => i);
    const { result, rerender } = renderHook(() => usePager(items, 50));
    act(() => result.current.setPage(2));
    items = items.slice(0, 60);
    rerender();
    expect(result.current).toMatchObject({ page: 0, pages: 2, total: 60 });
    act(() => result.current.setPage(1));
    act(() => result.current.setSize(25));
    expect(result.current).toMatchObject({ page: 0, pages: 3, size: 25 });
  });

  it('handles an empty list', () => {
    const { result } = renderHook(() => usePager([] as number[], 50));
    expect(result.current).toMatchObject({ page: 0, pages: 1, total: 0, from: 0, to: 0, slice: [] });
  });
});
