import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startStudioHost } from "../packages/studio-host/src/index.ts";

// Agents work with design tokens and components through MCP (ADR-0004, ADR-0005): each change one
// transaction attributed to the agent, undone by the person's Undo; deleting a token needs the
// person's approval.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 20, 0, 0) + clock++ * 1000).toISOString();

async function withAgent(callback) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-mcp-design-")));
  const host = await startStudioHost({ projectsRoot: root, now, confirmationWaitMs: 2_000 });
  const owner = (method, path, body) => fetch(`${host.url}${path}`, {
    method,
    headers: { authorization: `Bearer ${host.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }).then(async (response) => ({ status: response.status, json: await response.json().catch(() => null) }));
  let id = 0;
  const mcp = (token, method, params) => fetch(host.mcpUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }), id: ++id }),
  }).then((response) => response.json());
  try {
    const { token } = (await owner("POST", "/api/agents/create", { name: "Agent" })).json;
    await owner("POST", "/api/projects/create", { name: "site" });
    await mcp(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const tool = async (name, args = {}) => (await mcp(token, "tools/call", { name, arguments: args })).result;
    const ok = async (name, args) => {
      const result = await tool(name, args);
      assert.notEqual(result.isError, true, `${name}: ${result.content?.[0]?.text}`);
      return result.structuredContent;
    };
    await callback({ host, owner, tool, ok });
  } finally {
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
}

const refusal = (result) => (assert.equal(result.isError, true), result.content[0].text);

test("an agent sets, renames and modes design tokens, each change its own, and the person reverts one", async () => {
  await withAgent(async ({ host, owner, tool, ok }) => {
    assert.equal((await ok("design_tokens")).designSystem, null);
    await ok("set_token", { name: "--brand", type: "color", values: { default: "#2255ff" } });
    await ok("set_token", { name: "--link", type: "color", collection: "base", values: { default: "var(--brand)" } });
    await ok("add_token_mode", { collection: "base", name: "Dark" });
    await ok("set_token", { name: "--brand", values: { dark: "#88aaff" } });
    const frame = (await ok("create_frame", { width: 200, height: 100, name: "Hero" })).nodeId;
    await ok("set_styles", { updates: [{ nodeId: frame, styles: { color: "var(--link)" } }] });
    await ok("set_layer_modes", { nodeIds: [frame], collection: "base", mode: "dark" });
    await ok("rename_token", { from: "--brand", to: "--primary" });
    const tokens = await ok("design_tokens");
    assert.deepEqual(tokens.tokens.map(({ name, values, uses }) => [name, values, uses]), [
      ["--primary", { default: "#2255ff", dark: "#88aaff" }, 0],
      ["--link", { default: "var(--primary)", dark: "var(--primary)" }, 1],
    ]);
    assert.deepEqual(host.session.document.nodes[frame].props.modes, { base: "dark" });
    // Refusals say why, and change nothing.
    assert.match(refusal(await tool("set_token", { name: "--loop", type: "color", collection: "base", values: { default: "var(--loop)" } })), /cycle/u);
    assert.match(refusal(await tool("set_token", { name: "--x", type: "color", collection: "base", values: { default: "red; } body {" } })), /CSS value|character/u);
    assert.match(refusal(await tool("set_layer_modes", { nodeIds: [frame], collection: "base", mode: "sepia" })), /not a mode of base/u);
    // Each change is the agent's own, and the person reverts its latest: the rename, whole.
    const last = host.session.log.at(-1);
    assert.equal(last.tool, "rename_token");
    assert.equal((await owner("POST", "/api/revert", { transactionId: last.transactionId })).status, 200);
    assert.equal((await ok("design_tokens")).tokens[0].name, "--brand", "the person's Revert takes the rename back");
    assert.equal(host.session.document.nodes[frame].props.style.color, "var(--link)");
  });
});

test("deleting a token needs the person's approval, and its uses get its replacement", async () => {
  await withAgent(async ({ host, owner, tool, ok }) => {
    await ok("set_token", { name: "--brand", type: "color", values: { default: "#2255ff" } });
    await ok("set_token", { name: "--ink", type: "color", collection: "base", values: { default: "#111" } });
    const frame = (await ok("create_frame", { width: 100, height: 100 })).nodeId;
    await ok("set_styles", { updates: [{ nodeId: frame, styles: { color: "var(--brand)" } }] });
    const waiting = await tool("delete_token", { name: "--brand", replacement: { token: "--ink" } });
    assert.match(waiting.content[0].text, /Waiting for the person/u);
    const { pending } = (await owner("GET", "/api/confirmations")).json;
    assert.equal(pending[0].summary, "Delete token --brand, used by 1 value on 1 layer, replaced by --ink");
    await owner("POST", "/api/confirmations/decide", { id: pending[0].id, approve: true });
    await ok("delete_token", { name: "--brand", replacement: { token: "--ink" } });
    assert.equal(host.session.document.nodes[frame].props.style.color, "var(--ink)");
    assert.deepEqual((await ok("design_tokens")).tokens.map(({ name }) => name), ["--ink"]);
  });
});

test("an agent makes a component, gives it a property, places and changes an instance, and detaches it", async () => {
  await withAgent(async ({ host, tool, ok }) => {
    const card = (await ok("create_frame", { width: 200, height: 80, name: "Card" })).nodeId;
    await ok("set_text", { nodeId: card, text: "Hello" });
    const { componentId } = await ok("create_component", { nodeId: card, name: "Card" });
    const { propertyId } = await ok("add_component_property", { componentId, name: "Title", kind: "text", targetNodeId: componentId });
    const { instanceId } = await ok("insert_instance", { componentId, afterId: componentId });
    assert.deepEqual((await ok("list_components")).components, [{ id: componentId, name: "Card", properties: [{ id: propertyId, name: "Title", kind: "text", default: "Hello", target: { nodeId: componentId, field: "text" } }], instances: 1 }]);
    await ok("set_instance_values", { instanceId, values: { [propertyId]: "Pro" } });
    const [root] = (await ok("instance_layers", { instanceId })).layers;
    assert.equal(root.text, "Pro");
    await ok("set_instance_override", { instanceId, path: root.path, nodeId: root.nodeId, style: { color: "red" } });
    assert.deepEqual((await ok("instance_layers", { instanceId })).layers[0].override, { style: { color: "red" } });
    // Refusals.
    assert.match(refusal(await tool("set_instance_values", { instanceId, values: { [propertyId]: true } })), /takes text/u);
    assert.match(refusal(await tool("set_instance_values", { instanceId, values: { nope: "x" } })), /not a property/u);
    assert.match(refusal(await tool("set_instance_override", { instanceId, path: [], nodeId: "nowhere", text: "x" })), /draws no such layer/u);
    assert.match(refusal(await tool("set_instance_override", { instanceId, path: root.path, nodeId: root.nodeId, style: { background: "url(https://example.com/x.png)" } })), /could fetch or run something/u);
    assert.match(refusal(await tool("create_component", { nodeId: instanceId })), /cannot become a component/u);
    await ok("reset_instance", { instanceId });
    assert.equal((await ok("instance_layers", { instanceId })).layers[0].override, null);
    assert.equal(host.session.document.nodes[instanceId].props.propertyValues[propertyId], "Pro", "reset keeps values");
    const { nodeId } = await ok("detach_instance", { instanceId });
    assert.equal(host.session.document.nodes[nodeId].type, "frame");
    assert.equal(Object.hasOwn(host.session.document.nodes, instanceId), false);
    // Each change is the agent's own transaction.
    assert.deepEqual(host.session.log.slice(-7).map((entry) => entry.tool), ["create_component", "add_component_property", "insert_instance", "set_instance_values", "set_instance_override", "reset_instance", "detach_instance"]);
  });
});

test("an approval to delete a token holds only while that token, its uses and aliases stay as they were", async () => {
  await withAgent(async ({ host, owner, tool, ok }) => {
    await ok("set_token", { name: "--tmp", type: "color", values: { default: "#000" } });
    await ok("set_token", { name: "--brand", type: "color", collection: "base", values: { default: "#2255ff" } });
    await ok("set_token", { name: "--link", type: "color", collection: "base", values: { default: "var(--brand)" } });
    const frame = (await ok("create_frame", { width: 100, height: 100 })).nodeId;
    await ok("set_styles", { updates: [{ nodeId: frame, styles: { color: "var(--brand)" } }] });
    const call = { name: "--tmp", replacement: { literal: true } };
    // Declined: nothing changes.
    const declining = tool("delete_token", call);
    const ask = async () => {
      for (let tries = 0; tries < 200; tries += 1) {
        const { pending } = (await owner("GET", "/api/confirmations")).json;
        if (pending.length > 0) return pending[0];
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("no confirmation was requested");
    };
    const first = await ask();
    assert.equal(first.summary, "Delete token --tmp, used by 0 values on 0 layers, replaced by its default-mode value #000 on layers (in every mode) and by its own value per mode in the tokens that alias it");
    await owner("POST", "/api/confirmations/decide", { id: first.id, approve: false });
    assert.match((await declining).content[0].text, /declined/u);
    assert.equal((await ok("design_tokens")).tokens.length, 3);
    // Approved for --tmp, which then moves away and --brand takes its name: the approval does not
    // reach --brand, and the person is asked about it as it is now.
    const waiting = await tool("delete_token", call);
    assert.match(waiting.content[0].text, /Waiting for the person/u);
    await owner("POST", "/api/confirmations/decide", { id: (await ask()).id, approve: true });
    await ok("rename_token", { from: "--tmp", to: "--old" });
    await ok("rename_token", { from: "--brand", to: "--tmp" });
    const retried = tool("delete_token", call);
    const again = await ask();
    assert.match(again.summary, /^Delete token --tmp, used by 1 value on 1 layer, aliased by --link, /u, "the person sees what this name is now");
    await owner("POST", "/api/confirmations/decide", { id: again.id, approve: false });
    assert.match((await retried).content[0].text, /declined/u);
    assert.equal(host.session.document.nodes[frame].props.style.color, "var(--tmp)", "nothing was deleted on the first approval");
  });
});

test("bad input to the component and mode tools is refused, saying why", async () => {
  await withAgent(async ({ tool, ok }) => {
    await ok("set_token", { name: "--brand", type: "color", values: { default: "#2255ff" } });
    await ok("add_token_mode", { collection: "base", name: "داكن" });
    await ok("add_token_mode", { collection: "base", name: "ليلي" });
    assert.deepEqual((await ok("design_tokens")).collections[0].modes.map((mode) => mode.id), ["default", "mode", "mode-2"], "a slug that is taken gets the next number");
    assert.match(refusal(await tool("add_token_mode", { collection: "base", name: "Constructor" })), /a name a mode cannot have/u);
    const card = (await ok("create_frame", { width: 100, height: 100, name: "Card" })).nodeId;
    const { componentId } = await ok("create_component", { nodeId: card });
    assert.match(refusal(await tool("add_component_property", { componentId, name: "Size", kind: "slider", targetNodeId: componentId })), /kind is text, boolean, variant, instance-swap or slot/u);
    assert.match(refusal(await tool("add_component_property", { componentId, name: "Size", kind: "variant", targetNodeId: componentId })), /needs its options/u);
    assert.match(refusal(await tool("insert_instance", { componentId, afterId: "no-such-layer" })), /no node/u);
  });
});

test("an agent finds a library component by purpose and reads its exact API and provenance, changing nothing", async () => {
  await withAgent(async ({ host, tool, ok }) => {
    const revision = host.session.document.revision;
    const found = await ok("search_components", { query: "command palette" });
    assert.equal(found.components[0].id, "astryx:CommandPalette");
    assert.deepEqual(found.sources.map((source) => [source.id, source.commit]), [["astryx", "2309691dba9533635259113316a2cb14ec832933"]]);
    const overlays = await ok("search_components", { category: "Overlay", limit: 50 });
    assert.ok(overlays.components.length > 3 && overlays.components.every((entry) => entry.category === "Overlay"));
    assert.equal((await ok("search_components", { query: "no such widget at all" })).components.length, 0);
    const { component, provenance } = await ok("get_component", { id: "astryx:Button" });
    assert.deepEqual(component.variants.find((variant) => variant.prop === "variant").values, ["primary", "secondary", "ghost", "destructive"]);
    assert.equal(component.props.find((prop) => prop.name === "label").required, true);
    assert.deepEqual([provenance.commit, provenance.license.spdx, provenance.importPolicy, provenance.doc.path], ["2309691dba9533635259113316a2cb14ec832933", "MIT", "allowed", "packages/core/src/Button/Button.doc.mjs"]);
    assert.match(provenance.doc.sha256, /^[0-9a-f]{64}$/u);
    for (const id of ["astryx:NoSuch", "shadcn:Button", "Button", "__proto__:x", "constructor:Button"]) assert.match(refusal(await tool("get_component", { id })), /take ids from search_components/u, id);
    assert.match(refusal(await tool("search_components", { source: "shadcn" })), /source|enum|one of/u);
    assert.equal(host.session.document.revision, revision, "reading records changes nothing");
  });
});

test("the component record tools check their arguments and say what categories there are", async () => {
  await withAgent(async ({ tool, ok }) => {
    const found = await ok("search_components", { category: "overlay" });
    assert.ok(found.components.length > 3 && found.components.every((entry) => entry.category === "Overlay"), "a category in any case");
    assert.ok(found.categories.includes("Overlay") && found.categories.includes("Form Controls"));
    assert.equal((await ok("search_components", { limit: 50 })).components.length, 50);
    for (const limit of [0, -1, 51, 200, 2.5, "10"]) assert.match(refusal(await tool("search_components", { limit })), /limit is a whole number from 1 to 50/u, String(limit));
    assert.match(refusal(await tool("search_components", { query: "x", extra: 1 })), /takes no argument "extra"/u);
    assert.match(refusal(await tool("get_component", { id: "astryx:Button", source: "astryx" })), /takes no argument "source"/u);
    assert.match(refusal(await tool("search_components", { query: 7 })), /query is text/u);
    assert.match(refusal(await tool("get_component", { id: `astryx:${"x".repeat(400)}` })), /take ids from search_components/u);
  });
});

test("an agent adds a slot and fills an instance's slot with a component, never one that draws it", async () => {
  await withAgent(async ({ tool, ok, host }) => {
    const badge = (await ok("create_frame", { width: 40, height: 20, name: "Badge" })).nodeId;
    await ok("set_text", { nodeId: badge, text: "New" });
    const { componentId: badgeId } = await ok("create_component", { nodeId: badge, name: "Badge" });
    const card = (await ok("create_frame", { width: 200, height: 80, name: "Card" })).nodeId;
    const { componentId: cardId } = await ok("create_component", { nodeId: card, name: "Card" });
    const { propertyId } = await ok("add_component_property", { componentId: cardId, name: "Content", kind: "slot", targetNodeId: cardId });
    const { instanceId } = await ok("insert_instance", { componentId: cardId });
    await ok("set_instance_values", { instanceId, values: { [propertyId]: badgeId } });
    const layers = (await ok("instance_layers", { instanceId })).layers;
    const filled = layers.find((layer) => layer.text === "New");
    assert.deepEqual([filled.path, filled.nodeId, filled.componentId], [[], `${cardId}\u001fslot`, badgeId], "the badge drawn in the slot is a layer of the instance");
    await ok("set_instance_override", { instanceId, path: filled.path, nodeId: filled.nodeId, text: "Hot" });
    assert.ok((await ok("instance_layers", { instanceId })).layers.some((layer) => layer.text === "Hot"), "and takes an override like one");
    assert.match(refusal(await tool("set_instance_values", { instanceId, values: { [propertyId]: "nowhere" } })), /takes a component's id/u);
    assert.match(refusal(await tool("set_instance_values", { instanceId, values: { [propertyId]: cardId } })), /draws this instance's component/u);
    assert.ok(layers.every((layer) => layer.stale === false), "nothing it draws is stale");
    assert.equal(layers[0].componentId, null, "an ordinary layer names no component it draws");
    assert.match(refusal(await tool("add_component_property", { componentId: cardId, name: "Icon", kind: "instance-swap", targetNodeId: cardId })), /targets an instance inside the component/u);
    // A slot's default is a component, never one that draws this one.
    assert.match(refusal(await tool("add_component_property", { componentId: cardId, name: "Other", kind: "slot", targetNodeId: cardId, default: "nowhere" })), /default takes a component's id/u);
    assert.match(refusal(await tool("add_component_property", { componentId: cardId, name: "Other", kind: "slot", targetNodeId: cardId, default: cardId })), /that default draws this component/u);
    const { propertyId: other } = await ok("add_component_property", { componentId: cardId, name: "Other", kind: "slot", targetNodeId: cardId, default: badgeId });
    assert.equal(host.session.document.nodes[cardId].props.properties.find((property) => property.id === other).default, badgeId);
  });
});

test("an agent sets a layer's classes, text direction and aria attributes, and is refused what the canvas would not draw", async () => {
  await withAgent(async ({ host, owner, tool, ok }) => {
    const { nodeId: frame } = await ok("create_frame", { name: "Card", width: 200, height: 100 });
    const revision = host.session.document.revision;
    await ok("set_attributes", { updates: [{ nodeId: frame, attributes: { class: "  card  card wide ", dir: "rtl", lang: "ar", "aria-label": "بطاقة" } }] });
    assert.deepEqual(host.session.document.nodes[frame].props.attributes, { class: "card wide", dir: "rtl", lang: "ar", "aria-label": "بطاقة" }, "classes once each, in order");
    assert.equal(host.session.document.revision, revision + 1, "one change");
    // Each refusal names why, and changes nothing.
    for (const [attributes, message] of [
      [{ onclick: "x()" }, /onclick is not an attribute the canvas draws/u],
      [{ style: "color: red" }, /style is not an attribute the canvas draws/u],
      [{ dir: "sideways" }, /dir is "ltr", "rtl" or "auto"/u],
      [{ "bad name": "x" }, /is not an attribute name/u],
      [{ class: 7 }, /must be a string of at most 2000 characters, or null/u],
    ]) assert.match(refusal(await tool("set_attributes", { updates: [{ nodeId: frame, attributes }] })), message, JSON.stringify(attributes));
    assert.equal(host.session.document.revision, revision + 1, "nothing refused was stored");
    // null removes; removing the last attribute leaves none.
    await ok("set_attributes", { updates: [{ nodeId: frame, attributes: { class: null, dir: null, lang: null, "aria-label": null } }] });
    assert.equal(host.session.document.nodes[frame].props.attributes, undefined);
    // An attribute this element does not have (a link on a <main>) is refused too.
    assert.match(refusal(await tool("set_attributes", { updates: [{ nodeId: frame, attributes: { href: "https://example.com" } }] })), /href="https:\/\/example\.com" is not an attribute the canvas draws on this <main>/u);
    // An instance draws its component's attributes: they are set on the component.
    const { componentId } = await ok("create_component", { nodeId: frame, name: "Card" });
    const { instanceId } = await ok("insert_instance", { componentId, afterId: componentId });
    assert.match(refusal(await tool("set_attributes", { updates: [{ nodeId: instanceId, attributes: { dir: "rtl" } }] })), /is an instance, which draws its component's attributes/u);
    // Names match whatever their case, keeping the spelling stored (an SVG's viewBox); a value is
    // stored as the canvas draws it (a link trimmed, an input type lowercased).
    const base = host.session.document.revision;
    await owner("POST", "/api/edit", { baseRevision: base, intent: "Add an icon, a link and a field", operations: [
      { type: "insert-node", parentId: null, index: host.session.document.rootIds.length, node: { id: "icon", type: "vector", props: { tag: "svg", attributes: { viewBox: "0 0 10 10" } } } },
      { type: "insert-node", parentId: null, index: host.session.document.rootIds.length + 1, node: { id: "go", type: "element", props: { tag: "a", text: "Go" } } },
      { type: "insert-node", parentId: null, index: host.session.document.rootIds.length + 2, node: { id: "field", type: "element", props: { tag: "input" } } },
    ] });
    await ok("set_attributes", { updates: [{ nodeId: "icon", attributes: { viewbox: "0 0 24 24" } }, { nodeId: "go", attributes: { href: "  https://example.com/a  " } }, { nodeId: "field", attributes: { type: "EMAIL" } }] });
    assert.deepEqual(host.session.document.nodes.icon.props.attributes, { viewBox: "0 0 24 24" });
    assert.deepEqual([host.session.document.nodes.go.props.attributes, host.session.document.nodes.field.props.attributes], [{ href: "https://example.com/a" }, { type: "email" }]);
    await ok("set_attributes", { updates: [{ nodeId: "icon", attributes: { VIEWBOX: null } }] });
    assert.equal(host.session.document.nodes.icon.props.attributes, undefined);
    assert.match(refusal(await tool("set_attributes", { updates: [{ nodeId: "go", attributes: { "data-ninerr-id": "x" } }] })), /data-ninerr-id is not an attribute the canvas draws/u);
  });
});
