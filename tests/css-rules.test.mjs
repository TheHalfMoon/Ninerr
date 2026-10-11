import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPORT_SCHEMA_VERSION,
  cssLoadsOrExecutes,
  defaultImportPolicy,
  importHtmlSnapshot,
  sanitizeImportedStylesheet,
} from "../packages/import-stack/src/index.ts";
import { createPrng } from "./support/prng.mjs";

// #283 (found by P08-G11 dogfooding on StartBootstrap's sb-admin-2): an imported stylesheet
// was all or nothing, so one url() among a site's rules removed the whole sheet. Now only
// what loads or executes is removed, rule by rule, and the result is checked again as a whole.

const MAX = 1024 * 1024;
const clean = (css) => sanitizeImportedStylesheet(css, MAX);

test("a stylesheet keeps its safe rules and loses only what loads or executes", () => {
  const css = [
    "@charset \"utf-8\";",
    "@import url(https://example.com/theme.css);",
    "@import \"local.css\";",
    ":root{--blue:#4e73df;--font:\"Nunito\",sans-serif}",
    "body{margin:0;font-family:var(--font);background:url(https://example.com/bg.png) no-repeat}",
    ".icon{width:1rem;background-image:url(\"data:image/svg+xml,%3csvg%3e%3c/svg%3e\")}",
    "@font-face{font-family:Nunito;font-weight:400;src:url(nunito.woff2) format(\"woff2\")}",
    "@media (min-width:768px){.sidebar{width:14rem!important}.logo{background:url(x.png)}}",
    "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}",
    ".card{color:#333;&:hover{color:#000;cursor:url(hand.cur),pointer}}",
    "a[href=\"url(\"]{color:red}",
    "@unknown-rule x{color:red}",
    ".text{content:\"};{\";color:blue}",
  ].join("\n");
  const result = clean(css);
  assert.equal(result.unsafe, true);
  assert.equal(cssLoadsOrExecutes(result.cssText), false, "nothing left loads or executes");
  assert.equal(result.cssText, [
    "@charset \"utf-8\";",
    ":root{--blue:#4e73df;--font:\"Nunito\",sans-serif;}",
    "body{margin:0;font-family:var(--font);}",
    ".icon{width:1rem;}",
    "@font-face{font-family:Nunito;font-weight:400;}",
    "@media (min-width:768px){.sidebar{width:14rem!important;}.logo{}}",
    "@keyframes spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}",
    ".card{color:#333;&:hover{color:#000;}}",
    ".text{content:\"};{\";color:blue;}",
  ].join(""));
  // Removed: background, background-image, src, the .logo background, cursor; and the two
  // @imports, the selector with url( in it, and the unknown at-rule.
  assert.deepEqual([result.removedDeclarations, result.removedRules], [5, 4]);
});

test("a stylesheet with nothing unsafe is kept exactly as written", () => {
  const css = "/* theme */ .a { color: red } @media print { .a { display: none } }";
  assert.deepEqual(clean(`  ${css}
`), { cssText: css, unsafe: false, removedDeclarations: 0, removedRules: 0 });
});

test("disguised loading is removed: escapes, comments, case and continuations", () => {
  for (const declaration of [
    "background:\\75rl(x.png)",
    "background:u\\72l(x.png)",
    "background:URL(x.png)",
    "background:u/**/rl(x.png)",
    "background:image-set(\"a.png\" 1x)",
    "width:expression(alert(1))",
    "-moz-binding:url(x.xml#a)",
    "behavior:url(x.htc)",
    "background:javascript:alert(1)",
  ]) {
    const result = clean(`.a{color:red;${declaration}}`);
    assert.equal(result.cssText, ".a{color:red;}", declaration);
    assert.equal(result.removedDeclarations, 1, declaration);
  }
  for (const rule of ["@\\69mport \"x.css\";", "@IMPORT \"x.css\";", "@import/**/\"x.css\";"]) {
    assert.equal(clean(`${rule}.a{color:red}`).cssText, ".a{color:red;}", rule);
  }
});

test("a stylesheet that does not parse is judged whole, as before", () => {
  assert.deepEqual(clean(".a{color:red;background:url(x)"), { cssText: null, unsafe: true, removedDeclarations: 0, removedRules: 1 });
  assert.deepEqual(clean(".a{color:red"), { cssText: ".a{color:red", unsafe: false, removedDeclarations: 0, removedRules: 0 });
  assert.equal(clean(`${"@media screen{".repeat(40)}.a{color:red}${"}".repeat(40)}`).cssText.startsWith("@media"), true, "too deep: judged whole, and safe");
  assert.throws(() => sanitizeImportedStylesheet("a".repeat(11), 10), /maxCssBytes/u);
});

test("whatever the input, nothing kept loads or executes (generated)", () => {
  const random = createPrng(283);
  const parts = [
    ".a", "{", "}", ";", ":", "color:red", "url(", "x.png", ")", "@import", "@media screen", "\"", "'", "\\", "\\75", "rl(",
    "/*", "*/", "image(", "image-set(", "expression(", "javascript:", "behavior:", "-moz-binding:", "&", " ", "\n", "[", "]",
    "@font-face", "src:", "@keyframes k", "from", "to", "%", "@layer a", ",", "--x:", "{{", "}}",
  ];
  for (let run = 0; run < 3000; run += 1) {
    const css = Array.from({ length: random.int(1, 40) }, () => random.pick(parts)).join("");
    const result = clean(css);
    if (result.cssText !== null) assert.equal(cssLoadsOrExecutes(result.cssText), false, JSON.stringify(css));
  }
});

test("an imported page keeps the safe rules of its stylesheet and says what was removed", () => {
  const request = {
    schemaVersion: IMPORT_SCHEMA_VERSION,
    requestId: "import-css",
    actorId: "user-1",
    intent: "Import a page with a stylesheet",
    at: "2026-10-11T12:00:00.000Z",
    source: { kind: "html-snapshot", uri: "https://example.com/page", baseUrl: "https://example.com/page" },
    policy: defaultImportPolicy("offline"),
  };
  const proposal = importHtmlSnapshot(request, "<style>.title{color:#4e73df;font-weight:800}.hero{background:url(hero.png);padding:2rem}</style><h1 class=\"title\">Dashboard</h1>");
  assert.deepEqual(proposal.stylesheets.map((sheet) => sheet.cssText), [".title{color:#4e73df;font-weight:800;}.hero{padding:2rem;}"]);
  const diagnostic = proposal.diagnostics.find((entry) => entry.code === "unsafe-css-removed");
  assert.match(diagnostic?.message ?? "", /Removed 1 declaration\(s\) and 0 rule\(s\)/u);
  assert.equal(proposal.security.unsafeStylesRemoved, 1);
});
