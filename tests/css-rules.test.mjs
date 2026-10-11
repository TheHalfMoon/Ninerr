import test from "node:test";
import assert from "node:assert/strict";

import {
  IMPORT_SCHEMA_VERSION,
  cssLoadsOrExecutes,
  defaultImportPolicy,
  importHtmlSnapshot,
  sanitizeImportedStylesheet,
} from "../packages/import-stack/src/index.ts";
import { browserTestOptions, findBrowser } from "./support/browser.mjs";
import { createPrng } from "./support/prng.mjs";

// #283 (found by P08-G11 dogfooding on StartBootstrap's sb-admin-2): an imported stylesheet
// was all or nothing, so one url() among a site's rules removed the whole sheet. Now only
// what loads or executes is removed, and everything else is kept exactly as written.

const MAX = 1024 * 1024;
const clean = (css) => sanitizeImportedStylesheet(css, MAX);
// One loading declaration, so the rule-by-rule path is taken.
const LOADS = ".zz{color:red;background:url(x.png)}";

test("a stylesheet keeps everything as written except what loads or executes", () => {
  const css = [
    "@charset \"utf-8\";",
    "@import url(https://example.com/theme.css);",
    ":root{--blue:#4e73df}",
    "body { margin: 0; background: url(https://example.com/bg.png) no-repeat; color: #858796 }",
    "@font-face{font-family:Nunito;src:url(nunito.woff2) format(\"woff2\");font-weight:400}",
    "@media (min-width:768px){.sidebar{width:14rem!important}.logo{background:url(x.png)}}",
    "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}",
    ".card{color:#333;&:hover{color:#000;cursor:url(hand.cur),pointer}}",
    "a[href=\"url(\"]{color:red}",
    "@unknown-rule x{color:red}",
    "@unknown-loading x{background:url(y)}",
  ].join("\n");
  const result = clean(css);
  assert.equal(result.unsafe, true);
  assert.equal(cssLoadsOrExecutes(result.cssText), false, "nothing left loads or executes");
  assert.equal(result.cssText, [
    "@charset \"utf-8\";",
    ":root{--blue:#4e73df}",
    "body { margin: 0; color: #858796 }",
    "@font-face{font-family:Nunito;font-weight:400}",
    "@media (min-width:768px){.sidebar{width:14rem!important}.logo{}}",
    "@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}",
    ".card{color:#333;&:hover{color:#000;}}",
    "@unknown-rule x{color:red}",
  ].join("\n"));
  // Removed: background, src, the .logo background, cursor; and the @import, the selector
  // with url( in it, and the unknown at-rule that loads.
  assert.deepEqual([result.removedDeclarations, result.removedRules], [4, 3]);
});

test("a stylesheet with nothing unsafe is kept exactly as written", () => {
  const css = "/* theme */ .a { color: red } @media print { .a { display: none } }";
  assert.deepEqual(clean(`  ${css}\n`), { cssText: css, unsafe: false, removedDeclarations: 0, removedRules: 0 });
});

test("disguised loading is removed: escapes, comments, case, src() and a style end tag", () => {
  for (const declaration of [
    "background:\\75rl(x.png)",
    "background:u\\72l(x.png)",
    "background:URL(x.png)",
    "background:u/**/rl(x.png)",
    "background:image-set(\"a.png\" 1x)",
    "background-image:src(\"x.png\")",
    "width:expression(alert(1))",
    "-moz-binding:url(x.xml#a)",
    "behavior:url(x.htc)",
    "background:javascript:alert(1)",
    "content:\"</style><img src=x onerror=alert(1)>\"",
  ]) {
    const result = clean(`.a{color:red;${declaration}}`);
    assert.equal(result.cssText, ".a{color:red;}", declaration);
    assert.equal(result.removedDeclarations, 1, declaration);
  }
  for (const rule of ["@\\69mport \"x.css\";", "@IMPORT \"x.css\";", "@import/**/\"x.css\";"]) {
    assert.equal(clean(`${rule}.a{color:red}`).cssText, ".a{color:red}", rule);
  }
  // A comment that, removed, would spell an end tag is kept, and the gate judges it.
  assert.equal(clean(".b{background:url(x)}</sty/**/le><img src=x onerror=alert(1)>{}").cssText, ".b{}");
});

test("a stylesheet whose structure does not close is judged whole, as before", () => {
  assert.deepEqual(clean(".a{color:red;background:url(x)"), { cssText: null, unsafe: true, removedDeclarations: 0, removedRules: 1 });
  assert.deepEqual(clean(".a{color:red"), { cssText: ".a{color:red", unsafe: false, removedDeclarations: 0, removedRules: 0 });
  const deep = `${"@media screen{".repeat(40)}${LOADS}${"}".repeat(40)}`;
  assert.deepEqual(clean(deep), { cssText: null, unsafe: true, removedDeclarations: 0, removedRules: 1 });
  assert.throws(() => sanitizeImportedStylesheet("a".repeat(11), 10), /maxCssBytes/u);
});

test("whatever the input, nothing kept loads or executes (generated)", () => {
  const random = createPrng(283);
  const parts = [
    ".a", "{", "}", ";", ":", "color:red", "url(", "x.png", ")", "@import", "@media screen", "\"", "'", "\\", "\\75", "rl(",
    "/*", "*/", "image(", "image-set(", "src(", "expression(", "javascript:", "behavior:", "-moz-binding:", "&", " ", "\n", "[", "]",
    "@font-face", "@scope", "--x:", "@keyframes k", "from", "to", "%", "@layer a", ",", "{{", "}}", "</style", "<!--", "-->",
  ];
  for (let run = 0; run < 3000; run += 1) {
    const css = Array.from({ length: random.int(1, 40) }, () => random.pick(parts)).join("");
    const result = clean(css);
    if (result.cssText !== null) assert.equal(cssLoadsOrExecutes(result.cssText), false, JSON.stringify(css));
  }
});

// What the browser reads from the sanitized sheet must be what it reads from the original
// with only the loading parts removed by hand. Each case holds its loading part ("$L", a
// declaration; "$I", an @import) inside the structure it tests, so that structure is cut
// through, not kept whole.
const LOAD = "background:url(x.png);";
const IMPORT = "@import \"f.css\";";
const SAME_MEANING = [
  ["escaped whitespace in a selector", ".a\\ {$Lcolor:red}.b{color:blue}"],
  ["escaped whitespace in a value", ".a{$Lfont-family:Foo\\ ;color:blue}"],
  ["a bad string", ".a{$Lcontent:\"abc\n;color:red}.b{color:blue}"],
  ["a comment between tokens", ".a{$Lmargin:1px/**/2px}a/**/b{$Lcolor:red}"],
  ["a custom property holding a block", ".a{--x:{a:b};$Lcolor:blue}"],
  ["a group rule nested in a style rule", ".a{color:red;@media (min-width:1px){$Lcolor:blue}}"],
  ["@scope with bare declarations", "@scope (.card){$Lcolor:red}"],
  ["@page margin rules", "@page{margin:1cm;@top-center{$Lcontent:\"x\"}}"],
  ["@font-feature-values blocks", "@font-feature-values Font{@styleset{nice:1}}.a{$Lcolor:red}"],
  ["a stray semicolon in a selector", ".b;c{$Lcolor:blue}.d{color:green}"],
  ["a stray closing brace", "}.d{$Lcolor:green}"],
  ["HTML comment markers", "<!-- .a{$Lcolor:red} -->.b{color:blue}"],
  ["a comment before an @import", "/* fonts */$I\n.a{color:red}"],
  ["a comment line between rules and an @import", ".z{color:green}\n/* fonts */\n$I\n.a{color:red}"],
  ["an @import inside HTML comment markers", "<!-- $I .a{color:red} -->"],
  ["a brace inside an unquoted url", ".a{background:url(x});color:red}.b{color:blue}"],
];
const sanitizedInput = (css) => css.replaceAll("$L", LOAD).replaceAll("$I", IMPORT);
const byHand = (css) => css.replaceAll("$L", "").replaceAll("$I", "").replace("background:url(x});", "");

test("the browser reads the kept rules as it reads the original", browserTestOptions(), async () => {
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    const rules = (css) => page.evaluate((text) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      return [...sheet.cssRules].map((rule) => rule.cssText);
    }, css);
    for (const [what, css] of SAME_MEANING) {
      const result = clean(sanitizedInput(css));
      assert.equal(result.unsafe, true, what);
      assert.deepEqual(await rules(result.cssText ?? ""), await rules(byHand(css)), what);
    }
  } finally {
    await browser.close();
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
  assert.deepEqual(proposal.stylesheets.map((sheet) => sheet.cssText), [".title{color:#4e73df;font-weight:800}.hero{padding:2rem}"]);
  const diagnostic = proposal.diagnostics.find((entry) => entry.code === "unsafe-css-removed");
  assert.match(diagnostic?.message ?? "", /Removed 1 declaration\(s\) and 0 rule\(s\)/u);
  assert.equal(proposal.security.unsafeStylesRemoved, 1);
});

test("a captured stylesheet keeps its safe rules, and sheets past the CSS budget are left out and said", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { disposeStaticMirror, mirrorStaticSite, proposalFromStaticMirror } = await import("../packages/import-stack/src/index.ts");
  const dir = await mkdtemp(join(tmpdir(), "ninerr-css-mirror-"));
  try {
    const policy = { ...defaultImportPolicy("remote"), maxMirrorDepth: 1, maxCssBytes: 64 };
    const grant = { id: "grant-example", capability: "import.fetch", scheme: "https", host: "example.com", port: null, allowPrivateNetwork: false, purpose: "css-rules test" };
    const request = {
      schemaVersion: IMPORT_SCHEMA_VERSION,
      requestId: "import-mirror-css",
      actorId: "user-1",
      intent: "Mirror a page with two stylesheets",
      at: "2026-10-11T12:00:00.000Z",
      source: { kind: "remote-url", uri: "https://example.com/page.html", baseUrl: "https://example.com/page.html" },
      policy,
      networkPolicy: { schemaVersion: 1, mode: "allowlist", grants: [grant] },
    };
    const bodies = new Map([
      ["https://example.com/page.html", { type: "text/html", body: "<link rel=\"stylesheet\" href=\"/a.css\"><link rel=\"stylesheet\" href=\"/b.css\"><p class=\"x\">x</p>" }],
      ["https://example.com/a.css", { type: "text/css", body: ".x{color:red}.y{background:url(/i.png)}" }],
      ["https://example.com/b.css", { type: "text/css", body: ".z{color:blue;margin:0 auto;padding:1rem 2rem;border:0}" }],
      ["https://example.com/i.png", { type: "image/png", body: "PNGDATA" }],
    ]);
    const result = await mirrorStaticSite(request, "https://example.com/page.html", { jobId: "mirror-css", workRoot: join(dir, "work") }, {
      resolveHost: async () => ["93.184.216.34"],
      fetchResource: async (url) => {
        const row = bodies.get(url.href);
        if (!row) throw new Error(`unexpected fetch ${url.href}`);
        return { status: 200, headers: { "content-type": row.type, "content-encoding": "identity" }, body: new TextEncoder().encode(row.body) };
      },
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    const proposal = await proposalFromStaticMirror(request, result.value);
    assert.deepEqual(proposal.stylesheets.map((sheet) => sheet.cssText), [".x{color:red}.y{}"]);
    assert.deepEqual(proposal.diagnostics.filter((entry) => /css|stylesheet/u.test(entry.code)).map((entry) => entry.code), ["unsafe-mirrored-css-removed", "mirrored-stylesheet-over-limit"]);
    await disposeStaticMirror(join(dir, "work"), result.value);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("sanitizing takes time in proportion to the sheet, however it is written", () => {
  const megabyte = 1024 * 1024;
  for (const [what, css] of [
    ["many statements after a long run of space", `${" ".repeat(500_000)}${"a;".repeat(260_000)}.z{background:url(x)}`],
    ["many braces in one custom property", `.a{${" ".repeat(500_000)}--x:${"{}".repeat(260_000)};background:url(x)}`],
    ["many comments and @imports", `${"/* c */@import \"x.css\";".repeat(40_000)}.a{color:red}`],
  ]) {
    const started = performance.now();
    sanitizeImportedStylesheet(css, megabyte);
    const took = performance.now() - started;
    assert.ok(took < 2_000, `${what}: ${Math.round(took)} ms`);
  }
});
