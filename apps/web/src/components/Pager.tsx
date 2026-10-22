import { useEffect, useMemo, useState } from 'react';
import { Button, cx, Select } from './ui.tsx';

/**
 * Client-side pagination for long lists. Real projects have thousands of gates and segments;
 * rendering them all at once (and mapping each one) made every screen crawl. The slice is what
 * the screen renders; counts and selection still work on the full list.
 */
export const PAGE_SIZES = [25, 50, 100, 250] as const;
export const DEFAULT_PAGE_SIZE = 50;

export interface Pager<T> {
  /** The items on the current page. */
  slice: T[];
  page: number;
  pages: number;
  size: number;
  total: number;
  /** 1-based positions of the first and last item on this page (0 when empty). */
  from: number;
  to: number;
  setPage: (page: number) => void;
  setSize: (size: number) => void;
}

export function usePager<T>(items: T[], defaultSize: number = DEFAULT_PAGE_SIZE): Pager<T> {
  const [page, setPage] = useState(0);
  const [size, setSizeState] = useState(defaultSize);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(page, pages - 1);
  // A new filter or search usually changes the count: start that result set from its first page.
  useEffect(() => setPage(0), [items.length]);
  const slice = useMemo(() => items.slice(current * size, current * size + size), [items, current, size]);
  return {
    slice,
    page: current,
    pages,
    size,
    total: items.length,
    from: items.length ? current * size + 1 : 0,
    to: Math.min(items.length, (current + 1) * size),
    setPage: (p) => setPage(Math.max(0, Math.min(pages - 1, p))),
    setSize: (n) => {
      setSizeState(n);
      setPage(0);
    },
  };
}

export function PagerBar<T>({ pager, label = 'items', className }: { pager: Pager<T>; label?: string; className?: string }) {
  const { total, from, to, page, pages, size, setPage, setSize } = pager;
  if (total <= PAGE_SIZES[0]) return null;
  return (
    <div className={cx('flex flex-wrap items-center gap-3 text-xs text-fg-muted', className)}>
      <span className="tabular-nums">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()} {label}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page">
          ‹ Prev
        </Button>
        <span className="tabular-nums">
          page {page + 1} of {pages}
        </span>
        <Button variant="ghost" className="px-2 py-1 text-xs" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page">
          Next ›
        </Button>
      </div>
      <label className="ml-auto flex items-center gap-1.5">
        per page
        <Select value={String(size)} onChange={(e) => setSize(Number(e.target.value))} aria-label="Items per page" className="py-0.5 text-xs">
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
