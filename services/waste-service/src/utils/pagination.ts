import type { Response } from "express";
import { dbPool } from "../config/database";

// Backward-compatible pagination for list endpoints. Without paging parameters a list endpoint answers exactly as
// before (every row, no extra fields). With ?limit=&offset= (or ?page=&pageSize=) it returns one page, a
// `pagination` object and an X-Total-Count header.

export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 500;

export type Page = { limit: number; offset: number };
export type PageResult<T> = { rows: T[]; total: number | null };

const badRequest = (message: string) => Object.assign(new Error(message), { statusCode: 400 });

function integer(value: unknown, name: string, min: number, max: number): number | undefined {
  if (value === undefined || value === "") return undefined;
  const text = String(value);
  if (!/^\d+$/.test(text)) throw badRequest(`${name} must be a whole number`);
  const n = Number(text);
  if (n < min || n > max) throw badRequest(`${name} must be between ${min} and ${max}`);
  return n;
}

/** Reads paging parameters. Returns undefined when none are given, which keeps the endpoint's original behaviour. */
export function parsePage(query: Record<string, unknown>): Page | undefined {
  const limit = integer(query.limit, "limit", 1, PAGE_MAX), offset = integer(query.offset, "offset", 0, 10_000_000);
  const page = integer(query.page, "page", 1, 1_000_000), pageSize = integer(query.pageSize, "pageSize", 1, PAGE_MAX);
  if ((limit !== undefined || offset !== undefined) && (page !== undefined || pageSize !== undefined)) {
    throw badRequest("Use either limit and offset, or page and pageSize");
  }
  if (page !== undefined || pageSize !== undefined) {
    const size = pageSize ?? PAGE_DEFAULT;
    return { limit: size, offset: ((page ?? 1) - 1) * size };
  }
  if (limit !== undefined || offset !== undefined) return { limit: limit ?? PAGE_DEFAULT, offset: offset ?? 0 };
  return undefined;
}

export function paginationMeta(page: Page, returned: number, total: number) {
  const nextOffset = page.offset + returned;
  return {
    limit: page.limit, offset: page.offset, total, returned,
    has_more: nextOffset < total, next_offset: nextOffset < total ? nextOffset : null,
    page: Math.floor(page.offset / page.limit) + 1, page_size: page.limit,
  };
}

/**
 * Runs a list query ending in ORDER BY (with a unique tie-breaker so pages never overlap). With a page, the same query
 * gets LIMIT/OFFSET and a separate count gives the total.
 */
export async function queryPage<T = Record<string, unknown>>(sql: string, params: unknown[], page?: Page): Promise<PageResult<T>> {
  if (!page) return { rows: (await dbPool.query(sql, params)).rows as T[], total: null };
  const n = params.length;
  const [rows, count] = await Promise.all([
    dbPool.query(`${sql} LIMIT $${n + 1} OFFSET $${n + 2}`, [...params, page.limit, page.offset]),
    dbPool.query(`SELECT count(*)::int AS total FROM (${sql}) counted`, params),
  ]);
  return { rows: rows.rows as T[], total: count.rows[0].total };
}

/** Sends a list in the endpoint's original shape, adding pagination details only for paged requests. */
export function sendList<T>(res: Response, message: string, result: PageResult<T>, page?: Page) {
  if (!page || result.total === null) return res.json({ success: true, message, data: result.rows });
  res.setHeader("X-Total-Count", String(result.total));
  return res.json({ success: true, message, data: result.rows, pagination: paginationMeta(page, result.rows.length, result.total) });
}
