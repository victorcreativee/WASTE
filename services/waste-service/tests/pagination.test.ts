import test from "node:test";
import assert from "node:assert/strict";
import { PAGE_DEFAULT, PAGE_MAX, paginationMeta, parsePage } from "../src/utils/pagination";

test("no paging parameters keeps the original, unpaged behaviour", () => {
  assert.equal(parsePage({}), undefined);
  assert.equal(parsePage({ status: "open", limit: "" }), undefined);
});

test("limit and offset, with defaults", () => {
  assert.deepEqual(parsePage({ limit: "25", offset: "50" }), { limit: 25, offset: 50 });
  assert.deepEqual(parsePage({ offset: "10" }), { limit: PAGE_DEFAULT, offset: 10 });
  assert.deepEqual(parsePage({ limit: "5" }), { limit: 5, offset: 0 });
});

test("page and pageSize translate to an offset", () => {
  assert.deepEqual(parsePage({ page: "3", pageSize: "20" }), { limit: 20, offset: 40 });
  assert.deepEqual(parsePage({ page: "2" }), { limit: PAGE_DEFAULT, offset: PAGE_DEFAULT });
});

test("invalid or excessive values are refused", () => {
  assert.throws(() => parsePage({ limit: "0" }), /between 1 and 500/);
  assert.throws(() => parsePage({ limit: String(PAGE_MAX + 1) }), /between 1 and 500/);
  assert.throws(() => parsePage({ limit: "-5" }), /whole number/);
  assert.throws(() => parsePage({ offset: "1.5" }), /whole number/);
  assert.throws(() => parsePage({ limit: "10", page: "2" }), /either limit and offset, or page and pageSize/);
});

test("pagination details say whether more rows follow", () => {
  assert.deepEqual(paginationMeta({ limit: 10, offset: 20 }, 10, 45), { limit: 10, offset: 20, total: 45, returned: 10, has_more: true, next_offset: 30, page: 3, page_size: 10 });
  assert.deepEqual(paginationMeta({ limit: 10, offset: 40 }, 5, 45), { limit: 10, offset: 40, total: 45, returned: 5, has_more: false, next_offset: null, page: 5, page_size: 10 });
  assert.equal(paginationMeta({ limit: 10, offset: 100 }, 0, 45).has_more, false);
});
