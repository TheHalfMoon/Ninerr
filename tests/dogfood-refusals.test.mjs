import test from "node:test";
import assert from "node:assert/strict";

import { isSelectionRefusal, withoutSelectionRefusals } from "../scripts/dogfood/refusals.mjs";

// #377: journey F accepts one refusal and no other.
const REFUSED = JSON.stringify({ error: { code: "project-changed", message: "this change was made for project \"a\", but project \"b\" is open now" } });
const LINE = { text: "Failed to load resource: the server responded with a status of 409 (Conflict)", url: "http://127.0.0.1:1234/api/selection" };

test("only a project-changed 409 to POST /api/selection is the refusal", () => {
  assert.equal(isSelectionRefusal("POST", "/api/selection", 409, REFUSED), true);
  assert.equal(isSelectionRefusal("GET", "/api/selection", 409, REFUSED), false, "another method");
  assert.equal(isSelectionRefusal("POST", "/api/edit", 409, REFUSED), false, "another route");
  assert.equal(isSelectionRefusal("POST", "/api/selection/x", 409, REFUSED), false, "a longer route");
  assert.equal(isSelectionRefusal("POST", "/api/selection", 500, REFUSED), false, "another status");
  assert.equal(isSelectionRefusal("POST", "/api/selection", 409, JSON.stringify({ error: { code: "stale-revision" } })), false, "another code");
  assert.equal(isSelectionRefusal("POST", "/api/selection", 409, "not json"), false, "an unreadable body");
  assert.equal(isSelectionRefusal("POST", "/api/selection", 409, "null"), false);
  assert.equal(isSelectionRefusal("POST", "/api/selection", 409, undefined), false, "no body seen");
});

test("each refusal seen explains one line, and nothing else is explained", () => {
  assert.deepEqual(withoutSelectionRefusals([LINE], 1), { errors: [], accepted: [LINE] });
  assert.deepEqual(withoutSelectionRefusals([LINE], 0), { errors: [LINE], accepted: [] }, "no body seen");
  assert.deepEqual(withoutSelectionRefusals([LINE, LINE], 1), { errors: [LINE], accepted: [LINE] }, "two lines, one refusal");
  assert.deepEqual(withoutSelectionRefusals([], 3), { errors: [], accepted: [] });
  for (const other of [
    { ...LINE, url: "http://127.0.0.1:1234/api/edit" },
    { ...LINE, url: "http://127.0.0.1:1234/api/selection/x" },
    { ...LINE, text: "Failed to load resource: the server responded with a status of 500 (Internal Server Error)" },
    { text: "TypeError: x is not a function", url: "http://127.0.0.1:1234/api/selection" },
    { text: LINE.text, url: undefined },
    { text: "boom" },
  ]) assert.deepEqual(withoutSelectionRefusals([other], 1), { errors: [other], accepted: [] }, JSON.stringify(other));
});
