import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startTestHost as startStudioHost } from "./support/cleanup.mjs";
import { browserTestOptions } from "./support/browser.mjs";
import { openEditor, waitRevision } from "./support/editor.mjs";

// #405 through the editor: in Component sources, the person pastes a registry item, reviews the
// plan (every file, the packages to add, the license), creates the files and brings the component
// onto the canvas. The item is written for this test; nothing is copied from a registry.

let clock = 0;
const now = () => new Date(Date.UTC(2026, 10, 9, 13, 0, 0) + clock++ * 1000).toISOString();
const ITEM = JSON.stringify({
  name: "notice-card",
  type: "registry:block",
  title: "Notice card",
  dependencies: ["@base-ui/react@^1"],
  files: [{ path: "blocks/notice-card.tsx", type: "registry:block", content: 'export function NoticeCard() {\n  return (\n    <section className="notice">\n      <h2>Heads up</h2>\n    </section>\n  );\n}\n' }],
  cssVars: { light: { notice: "#fff7e6" } },
});

test("find an Astryx component by purpose and read its props, accessibility and provenance", browserTestOptions(), async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-astryx-editor-")));
  const host = await startStudioHost({ projectsRoot: root, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("site");
    await page.locator("#dialog[open] button.primary", { hasText: "Create project" }).click();
    await waitRevision(page, 0);
    await page.locator("#action-component-sources").click();
    await page.locator("#component-source-query").fill("meta design system");
    await page.locator('#component-source-results [data-source-id="astryx"]').click();
    await page.locator("#source-component-query").fill("date picker");
    assert.ok((await page.locator("#source-component-results button").allTextContents()).some((text) => text.startsWith("DateInput")));
    await page.locator("#source-component-query").fill("button");
    await page.locator('#source-component-results [data-component-id="astryx:Button"]').click();
    const rows = await page.locator("#source-component-props tbody tr").evaluateAll((trs) => trs.map((tr) => [...tr.children].map((cell) => cell.textContent)));
    assert.deepEqual(rows.find(([name]) => name === "variant"), ["variant", "'primary' | 'secondary' | 'ghost' | 'destructive'", "no", "'secondary'"]);
    assert.deepEqual(rows.find(([name]) => name === "label"), ["label", "string", "yes", ""]);
    assert.match(await page.locator("#source-component-detail").textContent(), /1\.4\.3 Contrast \(Minimum\), 4\.5:1/u);
    assert.match(await page.locator("#source-component-provenance").textContent(), /^From packages\/core\/src\/Button\/Button\.doc\.mjs in @astryxdesign\/core 0\.7\.12, commit 2309691dba95\. MIT, Copyright \(c\) 2026 Meta Platforms, Inc\.$/u);
    // A category narrows the list; every result is in it.
    await page.locator("#source-component-query").fill("");
    await page.locator("#source-component-category").selectOption("Overlay");
    const overlays = await page.locator("#source-component-results button").allTextContents();
    assert.ok(overlays.length > 3 && overlays.every((text) => text.endsWith("— Overlay")) && overlays.some((text) => text.startsWith("Dialog")));
    assert.deepEqual(editor.errors, []);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("review a registry item, create its files and bring its component onto the canvas", browserTestOptions(), async () => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "ninerr-component-editor-")));
  const projects = join(root, "projects");
  const code = join(root, "app");
  mkdirSync(projects);
  mkdirSync(code);
  writeFileSync(join(code, "package.json"), JSON.stringify({ dependencies: { react: "^19.0.0" } }));
  const host = await startStudioHost({ projectsRoot: projects, now });
  const editor = await openEditor(host);
  try {
    const { page } = editor;
    await page.locator("#new-project-name").fill("site");
    await page.locator("#dialog[open] button.primary", { hasText: "Create project" }).click();
    await waitRevision(page, 0);
    await page.locator("#action-code").click();
    await page.locator("#codebase-folder").fill(code);
    await page.locator("#dialog[open] button.primary", { hasText: "Connect folder" }).click();
    await page.locator("#codebase-path").waitFor();
    await page.locator("#dialog[open] button", { hasText: "Close" }).last().click();

    await page.locator("#action-component-sources").click();
    await page.locator("#component-item-text").fill(ITEM);
    await page.locator("#component-item-url").fill("https://ui.shadcn.com/r/styles/base-nova/notice-card.json");
    await page.locator("#component-import-review").click();
    await page.locator("#component-import-files li").first().waitFor();
    assert.deepEqual(await page.locator("#component-import-files li").allTextContents(), ["components/notice-card.tsx (new)"]);
    assert.deepEqual(await page.locator("#component-import-dependencies li").allTextContents(), ["@base-ui/react@^1"]);
    assert.deepEqual(await page.locator("#component-import-tokens li").allTextContents(), ["--notice (color): new"]);
    assert.match(await page.locator("#component-import-decision").textContent(), /^shadcn\/ui: MIT\. Keep its license notice\.$/u);
    assert.equal(existsSync(join(code, "components")), false, "reviewing writes nothing");

    await page.locator("#component-import-apply").click();
    // Its --notice variable joins the design system (new, so the project becomes schema 2).
    await waitRevision(page, 1);
    await page.locator("#component-import-done").waitFor();
    const created = readFileSync(join(code, "components", "notice-card.tsx"), "utf8");
    assert.match(created, /^\/\/ Imported by Ninerr from https:\/\/ui\.shadcn\.com\/r\/styles\/base-nova\/notice-card\.json\.\n\/\/ shadcn\/ui: MIT\.\n\/\/ Copyright \(c\) 2023 shadcn\n\/\/ Permission is hereby granted/u);
    assert.ok(created.endsWith(JSON.parse(ITEM).files[0].content), "the item's own text follows the notice unchanged");

    await page.locator("#component-import-components button", { hasText: "Bring in" }).click();
    await waitRevision(page, 2);
    const heading = await page.evaluate(() => document.querySelector("iframe").contentDocument.querySelector("section.notice h2")?.textContent);
    assert.equal(heading, "Heads up");
    assert.match(await page.locator("#status").textContent(), /^Bring in NoticeCard from components\/notice-card\.tsx: \d+ layers added\./u);
  } finally {
    await editor.close();
    await host.close();
    rmSync(root, { recursive: true, force: true });
  }
});
