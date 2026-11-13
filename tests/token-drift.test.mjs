import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";
import { client, ok } from "./support/host-api.mjs";

// Token drift (#79, parity row D8): the design system's tokens against a stylesheet in the connected
// codebase, both ways, changing nothing.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 14, 4, 0, 0) + clock++ * 1000).toISOString();

const SYSTEM = { id: "system", type: "design-system", props: { name: "Design system", collections: [{ id: "base", name: "Base", modes: [{ id: "default", name: "Default" }, { id: "dark", name: "Dark" }], defaultMode: "default" }], tokens: [
  { name: "--color-brand", type: "color", collection: "base", values: { default: "#2255ff", dark: "#88aaff" } },
  { name: "--space-2", type: "spacing", collection: "base", values: { default: "12px" } },
  { name: "--only-design", type: "color", collection: "base", values: { default: "red" } },
] } };

test("the design system against a stylesheet in the codebase: same, changed, only in one, and nothing changed; then the editor shows it", browserTestOptions(), async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-token-drift-")));
  mkdirSync(join(root, "projects"));
  mkdirSync(join(root, "app", "src"), { recursive: true });
  const host = await startStudioHost({ projectsRoot: join(root, "projects"), now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("drift");
    await page.keyboard.press("Enter");
    await waitRevision(page, 0);
    const call = client(host.url, host.token);
    // Not connected: said so.
    const unconnected = await call("POST", "/api/tokens/drift", { file: "src/theme.css" });
    assert.deepEqual([unconnected.status, unconnected.json?.error?.code], [409, "no-codebase"]);

    const { document } = await ok(call("GET", "/api/document"), "document");
    await ok(call("POST", "/api/edit", { baseRevision: document.revision, intent: "A design system", operations: [{ type: "insert-node", parentId: null, index: document.rootIds.length, node: SYSTEM }] }), "system");
    await waitRevision(page, 1);
    await ok(call("POST", "/api/codebase/connect", { folder: join(root, "app") }), "connect");
    writeFileSync(join(root, "app", "src", "theme.css"), ":root { --color-brand: #2255ff; --space-2: 8px; --only-code: 4px; }\n.dark { --color-brand: #88aaff; }\n");

    const revision = (await ok(call("GET", "/api/document"), "document")).document.revision;
    const drift = await ok(call("POST", "/api/tokens/drift", { file: "src/theme.css" }), "drift");
    assert.equal(drift.file, "src/theme.css");
    assert.equal(drift.drift, true);
    assert.deepEqual(drift.counts, { same: 1, changed: 1, "only-in-code": 1, "only-in-design": 1 });
    assert.deepEqual(drift.tokens.map(({ name, status }) => [name, status]), [["--color-brand", "same"], ["--only-code", "only-in-code"], ["--only-design", "only-in-design"], ["--space-2", "changed"]]);
    assert.deepEqual(drift.tokens.find((token) => token.name === "--space-2"), { name: "--space-2", status: "changed", design: { default: "12px" }, code: { default: "8px" } });
    assert.equal((await ok(call("GET", "/api/document"), "document")).document.revision, revision, "comparing changes nothing");

    // In step: no drift.
    writeFileSync(join(root, "app", "src", "theme.css"), ":root { --color-brand: #2255ff; --space-2: 12px; --only-design: red; }\n");
    const agreed = await ok(call("POST", "/api/tokens/drift", { file: "src/theme.css" }), "agreed");
    assert.deepEqual([agreed.drift, agreed.counts.same], [false, 3]);

    // A mode the code sets and the design system has no value in is a difference.
    writeFileSync(join(root, "app", "src", "theme.css"), ":root { --color-brand: #2255ff; --space-2: 12px; --only-design: red; }\n.dark { --space-2: 16px; }\n");
    const extended = await ok(call("POST", "/api/tokens/drift", { file: "src/theme.css" }), "extended");
    assert.deepEqual(extended.tokens.find((token) => token.name === "--space-2"), { name: "--space-2", status: "changed", design: { default: "12px" }, code: { default: "12px", dark: "16px" }, reason: "the code sets a dark value the design system has none for" });

    // Only a stylesheet inside the connected folder is read.
    writeFileSync(join(root, "app", "src", "theme.js"), "export const x = 1;\n");
    const script = await call("POST", "/api/tokens/drift", { file: "src/theme.js" });
    assert.deepEqual([script.status, script.json?.error?.code], [400, "invalid-file"], "a file that is not a stylesheet, though it is there");
    for (const file of ["src/theme.js", "../outside.css", "/etc/x.css", "src\\theme.css", "missing.css"]) {
      const refused = await call("POST", "/api/tokens/drift", { file });
      assert.ok(refused.status === 400 || refused.status === 404, `${file}: ${refused.status} ${JSON.stringify(refused.json)}`);
    }

    // The editor's tokens dialog says it.
    writeFileSync(join(root, "app", "src", "theme.css"), ":root { --color-brand: #2255ff; --space-2: 8px; }\n");
    await page.locator("#action-tokens").click();
    await page.locator("#token-drift-file").fill("src/theme.css");
    await page.locator("#token-drift-compare").click();
    await page.locator("#token-drift-summary").waitFor();
    assert.equal(await page.locator("#token-drift-summary").textContent(), "src/theme.css differs from the design system: 1 the same, 1 different, 1 only in the design.");
    assert.deepEqual(await page.locator("#token-drift-tokens li").allTextContents(), ["--only-design: only in the design", "--space-2: different (design default: 12px; code default: 8px)"]);
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
