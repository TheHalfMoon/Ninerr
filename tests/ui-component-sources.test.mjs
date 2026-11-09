import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UI_COMPONENT_SOURCES,
  UI_COMPONENT_SOURCE_GROUPS,
  searchUiComponentSources,
} from "../packages/studio-web/src/ui-sources.mjs";

test("all twelve requested UI sources are present with stable unique IDs", () => {
  assert.equal(UI_COMPONENT_SOURCES.length, 12);
  assert.equal(new Set(UI_COMPONENT_SOURCES.map(({ id }) => id)).size, 12);
  assert.deepEqual(new Set(UI_COMPONENT_SOURCES.map(({ group }) => group)),
    new Set(["Foundation", "Specialist", "Gallery", "Marketplace"]));
  assert.equal(UI_COMPONENT_SOURCE_GROUPS[0], "All");
});

test("curated source entries have explicit, safe manual reuse gates", () => {
  for (const item of UI_COMPONENT_SOURCES) {
    assert.match(item.website, /^https:\/\//);
    assert.match(item.source, /^https:\/\//);
    assert.ok(item.usage.length > 20);
    assert.ok(item.rights.length > 15);
    assert.match(item.gate, /^(manual-install|manual-source-review|per-item-review)$/);
    assert.equal(Object.isFrozen(item), true);
  }
  const rare = UI_COMPONENT_SOURCES.find(({ id }) => id === "rareui");
  const beautiful = UI_COMPONENT_SOURCES.find(({ id }) => id === "beautiful-ui");
  assert.equal(rare.website, "https://rareui.in");
  assert.equal(beautiful.website, "https://www.beautifului.dev");
  assert.equal(Object.isFrozen(UI_COMPONENT_SOURCES), true);
});

test("search is local, case-insensitive, bounded and supports group filtering", () => {
  assert.equal(searchUiComponentSources({ query: "TOAST" })[0].id, "sonner");
  assert.deepEqual(searchUiComponentSources({ group: "Specialist" }).map(({ id }) => id),
    ["sonner", "vaul", "cmdk", "numberflow"]);
  assert.equal(searchUiComponentSources({ query: "  AI interfaces " })[0].id, "beautiful-ui");
  assert.deepEqual(searchUiComponentSources({ query: "no-such-library" }), []);
  assert.throws(() => searchUiComponentSources({ query: "x".repeat(201) }), TypeError);
  assert.throws(() => searchUiComponentSources({ query: null }), TypeError);
  assert.throws(() => searchUiComponentSources({ group: "Unknown" }), TypeError);
});
