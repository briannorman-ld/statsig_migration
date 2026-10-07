/** Console API response envelopes, matching the OpenAPI `allOf` wrappers (message/data/pagination). */

export interface Pagination {
  itemsPerPage: number;
  pageNumber: number;
  nextPage: string | null;
  previousPage: string | null;
  totalItems: number;
  all: string;
}

export function single<T>(data: T, message = 'Fetched successfully.'): { message: string; data: T } {
  return { message, data };
}

/**
 * A paginated list. `nextPage`/`previousPage` are relative URLs (path + query), as the real API
 * returns them; clients must treat them as opaque and stop when `nextPage` is null.
 */
export function paginated<T>(
  all: T[],
  opts: { path: string; page: number; limit: number; query?: Record<string, string> },
): { message: string; data: T[]; pagination: Pagination } {
  const page = Math.max(1, opts.page);
  const limit = Math.max(1, Math.min(opts.limit, 100));
  const start = (page - 1) * limit;
  const data = all.slice(start, start + limit);
  const url = (p: number) => {
    const q = new URLSearchParams({ ...(opts.query ?? {}), page: String(p), limit: String(limit) });
    return `${opts.path}?${q}`;
  };
  const hasNext = start + limit < all.length;
  return {
    message: 'Fetched successfully.',
    data,
    pagination: {
      itemsPerPage: limit,
      pageNumber: page,
      nextPage: hasNext ? url(page + 1) : null,
      previousPage: page > 1 ? url(page - 1) : null,
      totalItems: all.length,
      all: `${opts.path}?${new URLSearchParams(opts.query ?? {})}`,
    },
  };
}
