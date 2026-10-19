// Figma experiments for the 2026-10-18 design-platform study
// (docs/research/rea-design-platforms/FIGMA_2026-10-18.md, records E-FG-11 to E-FG-19).
//
// Run each block, in order, in the developer console of a NEW Figma design file you own:
// Figma documents the `figma` global there as the Plugin API, the same API its MCP server's
// `use_figma` write tool runs. Every block returns an object.
//
// How the study's results were made: the experiments were typed into the console in smaller
// steps on 2026-10-18, and their outputs assembled by hand into figma-experiments-2026-10-18.json
// (EVIDENCE_2026-10-18.md). This file restates those steps as blocks that produce the same fields;
// it was written afterwards and is the way to reproduce them, not a log of the session.
// Nothing here is Figma code: it only calls the documented Plugin API.
// This file is not run by Ninerr's CI.

// F-01 Auto Layout: fixed, fill and hug in a 400 px row; widen it; an absolute child; wrap;
// FILL and layoutGrow outside Auto Layout. F-02 constraints when the parent grows.
async function f01f02() {
  const R = {};
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  const row = figma.createFrame(); row.name = "F01 row";
  row.layoutMode = "HORIZONTAL"; row.itemSpacing = 8; row.paddingLeft = row.paddingRight = 12; row.paddingTop = row.paddingBottom = 6;
  row.primaryAxisSizingMode = "FIXED"; row.counterAxisSizingMode = "AUTO"; row.resize(400, 50);
  const rect = (n, w, h) => { const r = figma.createRectangle(); r.name = n; r.resize(w, h); return r; };
  const a = rect("fixed", 50, 20), b = rect("fill", 50, 30), t = figma.createText(); t.characters = "hug text";
  row.appendChild(a); row.appendChild(b); row.appendChild(t);
  b.layoutSizingHorizontal = "FILL"; t.layoutSizingHorizontal = "HUG";
  R.f01 = { row: { w: row.width, h: row.height }, fixed: { w: a.width, x: a.x }, fill: { w: b.width, x: b.x }, hug: { w: t.width, x: t.x } };
  row.resize(600, row.height);
  R.f01AfterWiden = { fill: b.width, hugX: t.x };
  const abs = rect("abs", 10, 10); row.appendChild(abs); abs.layoutPositioning = "ABSOLUTE"; abs.x = 5; abs.y = 5;
  R.f01Absolute = { x: abs.x, y: abs.y, inFlow: row.children.filter((c) => c.layoutPositioning !== "ABSOLUTE").length };
  row.layoutWrap = "WRAP"; row.counterAxisSpacing = 4;
  R.f01Wrap = { layoutWrap: row.layoutWrap, h: row.height };
  const plain = figma.createFrame(); plain.name = "F02 plain"; plain.x = 700; plain.resize(200, 200);
  const c = rect("child", 50, 50); plain.appendChild(c); c.x = 140; c.y = 140;
  try { c.layoutSizingHorizontal = "FILL"; R.fillOutsideAutoLayout = "accepted"; } catch (e) { R.fillOutsideAutoLayout = `threw: ${e.message}`; }
  try { c.layoutGrow = 1; R.growOutsideAutoLayout = `accepted, value=${c.layoutGrow}`; } catch (e) { R.growOutsideAutoLayout = `threw: ${e.message}`; }
  c.constraints = { horizontal: "MAX", vertical: "STRETCH" };
  plain.resize(300, 300);
  R.f02 = { x: c.x, y: c.y, w: c.width, h: c.height };
  return R;
}

// F-03 components: text and boolean properties, an instance with a property value and a fill
// override, a main-component change, structural edits inside the instance, reset, variants,
// a variant swap, detach.
async function f03() {
  const R = {};
  const comp = figma.createComponent(); comp.name = "Button"; comp.y = 200;
  comp.layoutMode = "HORIZONTAL"; comp.primaryAxisSizingMode = "AUTO"; comp.counterAxisSizingMode = "AUTO";
  comp.paddingLeft = comp.paddingRight = 16; comp.paddingTop = comp.paddingBottom = 8;
  comp.fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }];
  const label = figma.createText(); label.characters = "Label"; comp.appendChild(label);
  const text = comp.addComponentProperty("label", "TEXT", "Label");
  const shown = comp.addComponentProperty("showLabel", "BOOLEAN", true);
  label.componentPropertyReferences = { characters: text, visible: shown };
  R.defs = Object.fromEntries(Object.entries(comp.componentPropertyDefinitions).map(([k, v]) => [k, { type: v.type, defaultValue: v.defaultValue }]));
  const inst = comp.createInstance(); inst.x = 200; inst.y = 200;
  inst.setProperties({ [text]: "Buy now" });
  inst.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
  R.ids = { instance: inst.id, instanceChild: inst.children[0].id, mainChild: label.id };
  R.overrides = inst.overrides.map((o) => ({ id: o.id, fields: o.overriddenFields }));
  comp.fills = [{ type: "SOLID", color: { r: 0, g: 0.5, b: 0 } }]; comp.paddingLeft = 40;
  R.afterMainChange = { fill: inst.fills[0].color, paddingLeft: inst.paddingLeft, text: inst.children[0].characters, width: inst.width };
  try { inst.appendChild(figma.createRectangle()); R.appendInside = "accepted"; } catch (e) { R.appendInside = `threw: ${e.message}`; }
  try { inst.children[0].remove(); R.removeInside = "accepted"; } catch (e) { R.removeInside = `threw: ${e.message}`; }
  inst.resetOverrides();
  R.afterReset = { fill: inst.fills[0].color, text: inst.children[0].characters, overrides: inst.overrides.length };
  comp.name = "state=default";
  const hover = comp.clone(); hover.name = "state=hover"; hover.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
  const set = figma.combineAsVariants([comp, hover], figma.currentPage); set.name = "Button";
  R.variantProperties = Object.fromEntries(Object.entries(set.componentPropertyDefinitions).map(([k, v]) => [k, v.type]));
  inst.setProperties({ state: "hover" });
  R.afterSwap = { main: inst.mainComponent.name, properties: Object.fromEntries(Object.entries(inst.componentProperties).map(([k, v]) => [k, v.value])) };
  R.detach = comp.createInstance().detachInstance().type;
  return R;
}

// F-04 variables: a second mode (refused on a Starter plan), an alias, a type mismatch, an alias
// cycle, a bound fill and gap, a change to the aliased variable, deleting it.
async function f04() {
  const R = {};
  const col = figma.variables.createVariableCollection("Theme");
  const m = col.modes[0].modeId;
  try { col.addMode("Dark"); R.secondMode = "accepted"; } catch (e) { R.secondMode = `threw: ${e.message}`; }
  const base = figma.variables.createVariable("color/blue", col, "COLOR"); base.setValueForMode(m, { r: 0, g: 0, b: 1, a: 1 });
  const accent = figma.variables.createVariable("color/accent", col, "COLOR"); accent.setValueForMode(m, figma.variables.createVariableAlias(base));
  const space = figma.variables.createVariable("space/md", col, "FLOAT"); space.setValueForMode(m, 8);
  try { space.setValueForMode(m, { r: 1, g: 0, b: 0, a: 1 }); R.typeMismatch = "accepted"; } catch (e) { R.typeMismatch = `threw: ${e.message}`; }
  const x = figma.variables.createVariable("cyc/x", col, "COLOR"); x.setValueForMode(m, { r: 0, g: 1, b: 0, a: 1 });
  const y = figma.variables.createVariable("cyc/y", col, "COLOR"); y.setValueForMode(m, figma.variables.createVariableAlias(x));
  try { x.setValueForMode(m, figma.variables.createVariableAlias(y)); R.cycle = "no error"; } catch (e) { R.cycle = `threw: ${e.message}`; }
  R.xAfterCycle = x.valuesByMode[m];
  const card = figma.createFrame(); card.name = "F04 card"; card.y = 500; card.layoutMode = "VERTICAL";
  card.fills = [figma.variables.setBoundVariableForPaint({ type: "SOLID", color: { r: 0, g: 0, b: 0 } }, "color", accent)];
  card.setBoundVariable("itemSpacing", space);
  R.resolved = { fill: card.fills[0].color, gap: card.itemSpacing, bound: Object.keys(card.boundVariables) };
  base.setValueForMode(m, { r: 1, g: 0.5, b: 0, a: 1 });
  R.afterBaseChange = card.fills[0].color;
  base.remove();
  R.afterDelete = { accent: accent.valuesByMode[m], fill: card.fills[0].color, bound: card.fills[0].boundVariables ?? null };
  return R;
}

// F-05 atomicity: three writes, the third throws. F-06 undo grouping by commitUndo.
async function f05f06() {
  const R = {};
  const before = figma.currentPage.children.length;
  try { const a = figma.createRectangle(); a.name = "F05 a"; const b = figma.createRectangle(); b.name = "F05 b"; const t = figma.createText(); t.appendChild(a); }
  catch (e) { R.third = `threw: ${e.message}`; }
  R.created = figma.currentPage.children.length - before;
  const names = () => figma.currentPage.children.map((n) => n.name).filter((n) => n.startsWith("U-"));
  figma.createRectangle().name = "U-x"; figma.commitUndo();
  figma.createRectangle().name = "U-y"; figma.commitUndo();
  figma.createRectangle().name = "U-z";
  R.afterCreate = names();
  figma.triggerUndo(); await new Promise((r) => setTimeout(r, 800)); R.afterOneUndo = names();
  figma.triggerUndo(); await new Promise((r) => setTimeout(r, 800)); R.afterTwoUndos = names();
  return R;
}

// F-07 a stale write from a second client: open the same file in a second tab (client B).
// B: window.__read = { id: <row id>, spacing: row.itemSpacing };
// A: row.itemSpacing = 20; row.paddingLeft = 30;
// B, after waiting 3 s (A's values have arrived; record them): row.itemSpacing = window.__read.spacing + 1;
//   row.name += " (renamed by B)";
// Both, after another 3 s: read itemSpacing, paddingLeft and name.

// F-08 Figma's agent (the Agents panel): ask it for a pricing card that reuses the Button
// component; then, as a person, change a text inside its card and rename another layer; then
// press Undo under the agent's reply, and list the page's top-level layers.

// F-09 representation: the component as SVG, as REST JSON, and as CSS.
async function f09() {
  const comp = figma.currentPage.findOne((n) => n.type === "COMPONENT");
  return {
    svg: (await comp.exportAsync({ format: "SVG_STRING" })).slice(0, 200),
    restJsonKeys: Object.keys((await comp.exportAsync({ format: "JSON_REST_V1" })).document),
    css: await comp.getCSSAsync(),
  };
}
