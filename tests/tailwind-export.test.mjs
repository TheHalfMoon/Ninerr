import test from "node:test";
import assert from "node:assert/strict";

import { styleToTailwind } from "../packages/code-ir/src/index.ts";

// A layer's style as Tailwind classes (the Tailwind export): each declaration one class that
// sets exactly what it says. A utility where one says it exactly, an arbitrary value for a
// length, an arbitrary property for anything else, and what no class can carry left as a style.

test("each declaration becomes one class that says exactly what it does", () => {
  const { classes, left } = styleToTailwind({
    display: "flex", "flex-direction": "column", "align-items": "flex-start", "justify-content": "space-between",
    position: "absolute", "font-weight": "700", "text-align": "center",
    padding: "12px", "margin-top": "-4px", gap: "0.5rem", width: "50%", "z-index": "2",
  });
  assert.deepEqual(classes, [
    "flex", "flex-col", "items-start", "justify-between", "absolute", "font-bold", "text-center",
    "p-[12px]", "mt-[-4px]", "gap-[0.5rem]", "w-[50%]", "z-[2]",
  ]);
  assert.deepEqual(left, {});
});

test("anything a utility does not say exactly is an arbitrary property, with spaces and underscores encoded", () => {
  assert.deepEqual(styleToTailwind({
    padding: "12px 8px", color: "#1d4ed8", background: "linear-gradient(90deg, red, blue)", width: "calc(100% - 2rem)",
    "grid-template-columns": "repeat(2, 1fr)", "--brand-color": "a_b", display: "table", "font-weight": "650",
  }).classes, [
    "[padding:12px_8px]", "[color:#1d4ed8]", "[background:linear-gradient(90deg,_red,_blue)]", "[width:calc(100%_-_2rem)]",
    "[grid-template-columns:repeat(2,_1fr)]", "[--brand-color:a\\_b]", "[display:table]", "[font-weight:650]",
  ]);
});

test("a double-quoted font name is written single-quoted, and what no class can carry stays a style", () => {
  const { classes, left } = styleToTailwind({ "font-family": "\"Open Sans\", sans-serif", content: "'a\"b'", "grid-template-areas": "\"a\" \"b\"", "grid-area": "x[1]", "--a_b": "1" });
  assert.deepEqual(classes, ["[font-family:'Open_Sans',_sans-serif]", "[grid-template-areas:'a'_'b']"]);
  // A name with an underscore: in a class the underscore would read as a space.
  assert.deepEqual(left, { content: "'a\"b'", "grid-area": "x[1]", "--a_b": "1" });
});
