// Extended Ninerr CLI subcommands dispatched from bin/ninerr.mjs (`ninerr design ...`,
// `ninerr motion ...`, `ninerr components ...`, `ninerr tokens ...`, and subsequent product commands).
// Pure local execution, zero network.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  NINERR_COMPONENT_CATEGORIES,
  getNinerrComponent,
  searchNinerrComponents,
} from "@ninerr/component-sources";
import {
  ARCHETYPE_IDS,
  DOMAIN_ARCHETYPES,
  MOTION_PRESETS,
  MOTION_PRESET_IDS,
  MOTION_TOKENS,
  compileMotionReact,
  compileMotionStylesheet,
  evaluateMotionFrequency,
  evaluateTaste,
  getDomainArchetype,
  getSkill,
  lintMotionCss,
  listSkills,
  planDesignDirections,
  renderSkillMarkdown,
} from "@ninerr/design-intelligence";
import { openProject } from "@ninerr/persistence";
import {
  STANDARD_VIEWPORTS,
  buildCritiqueReport,
  discoverBrowser,
  improveDesignInMemory,
  renderAndInspect,
} from "@ninerr/vision";
import { exportHtml } from "./code.ts";
import { auditDesignSystem, planRegistryItemUpdate } from "./design-system-ops.ts";
import { resolveProjectsFolder } from "./projects-folder.ts";
import { analyzeCodebase, applyRedesignPlan, assertNoSymlinkPath, assertWorkspaceRoot, planRedesign, rollbackRedesign } from "./redesign.ts";
import { writeTrustedBytes, writeTrustedFile } from "./trusted-file.ts";

export interface CliRunOptions {
  version: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export const EXTENDED_CLI_COMMANDS = Object.freeze(["design", "motion", "components", "tokens", "preview", "critique", "audit", "improve", "redesign"]);
const BOOLEAN_FLAGS = new Set(["json", "help", "allow-ambient", "vision", "dry-run", "reduced-motion", "force"]);
const MAX_CLI_FILE_BYTES = 2 * 1024 * 1024;

function readBoundedTextFile(filePath: string, commandLabel: string): string {
  try {
    const pre = lstatSync(filePath);
    if (pre.isSymbolicLink() || !pre.isFile()) {
      throw new Error(`${commandLabel}: ${JSON.stringify(filePath)} must be a regular non-symlink file`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
  }
  const flags =
    constants.O_RDONLY |
    (typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0) |
    (typeof constants.O_NONBLOCK === "number" ? constants.O_NONBLOCK : 0);
  const fd = openSync(filePath, flags);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) {
      throw new Error(`${commandLabel}: ${JSON.stringify(filePath)} is not a regular file`);
    }
    if (stat.size > MAX_CLI_FILE_BYTES) {
      throw new Error(`${commandLabel}: ${JSON.stringify(filePath)} exceeds ${MAX_CLI_FILE_BYTES} bytes`);
    }
    const buf = Buffer.allocUnsafe(MAX_CLI_FILE_BYTES + 1);
    let total = 0;
    while (total < buf.length) {
      const n = readSync(fd, buf, total, buf.length - total, null);
      if (n === 0) break;
      total += n;
      if (total > MAX_CLI_FILE_BYTES) {
        throw new Error(`${commandLabel}: ${JSON.stringify(filePath)} exceeds ${MAX_CLI_FILE_BYTES} bytes`);
      }
    }
    return buf.subarray(0, total).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function parseFlags(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = Object.create(null);
  let afterDoubleDash = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (afterDoubleDash) {
      positionals.push(token);
      continue;
    }
    if (token === "--") {
      afterDoubleDash = true;
      continue;
    }
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 2) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        if (BOOLEAN_FLAGS.has(key)) {
          flags[key] = true;
        } else {
          const next = argv[i + 1];
          if (next !== undefined && !next.startsWith("--")) {
            flags[key] = next;
            i += 1;
          } else {
            flags[key] = true;
          }
        }
      }
    } else {
      positionals.push(token);
    }
  }
  return { positionals, flags };
}

function designHelp(): string {
  return [
    "Ninerr Design Intelligence CLI:",
    "  ninerr design archetypes [--json]",
    "  ninerr design archetype <id> [--json]",
    "  ninerr design plan --domain <domain> --name <product> [--density compact|balanced|spacious] [--theme light|dark|system] [--json]",
    "  ninerr design skills [list [--query <text>] | show <id> | render <id>] [--json]",
    "",
  ].join("\n");
}

function motionHelp(): string {
  return [
    "Ninerr Motion System CLI:",
    "  ninerr motion presets [--json]",
    "  ninerr motion compile --presets <id,id,...> [--selector <css>] [--json]",
    "  ninerr motion react <presetId> [--json]",
    "  ninerr motion lint <file.css> [--allow-ambient] [--json]",
    "  ninerr motion frequency --trigger <name> --preset <id> [--daily-uses <n>] [--json]",
    "",
  ].join("\n");
}

function componentsHelp(): string {
  return [
    "Ninerr Native Components CLI:",
    "  ninerr components list [--category <category>] [--query <text>] [--json]",
    "  ninerr components show <id> [--json]",
    "",
  ].join("\n");
}

function tokensHelp(): string {
  return [
    "Ninerr Design Systems CLI:",
    "  ninerr tokens audit <project-folder> [--json]",
    "  ninerr tokens merge --base <file> --local <file> --upstream <file> [--json]",
    "",
  ].join("\n");
}

function visionHelp(): string {
  return [
    "Ninerr Vision & Critic CLI:",
    "  ninerr preview <project-folder> [--node <id>] [--viewports mobile,desktop] [--out <dir>] [--scheme light|dark] [--reduced-motion] [--json]",
    "  ninerr critique <project-folder> [--node <id>] [--vision] [--viewports mobile,desktop] [--json]",
    "  ninerr audit <project-folder> [--node <id>] [--vision] [--json]",
    "  ninerr improve <project-folder> [--node <id>] [--max-iterations 3] [--vision] [--dry-run] [--json]",
    "",
  ].join("\n");
}

/** Run an extended `ninerr` subcommand; returns process exit code (0 on success, 2 on usage error). */
export async function runCliCommand(command: string, args: string[], options: CliRunOptions): Promise<number> {
  const out = options.stdout ?? ((text: string) => process.stdout.write(text));
  const err = options.stderr ?? ((text: string) => process.stderr.write(text));
  const { positionals, flags } = parseFlags(args);
  const asJson = flags.json === true;

  try {
    if (command === "design") {
      const sub = positionals[0];
      if (!sub || sub === "help" || flags.help === true) {
        out(designHelp());
        return 0;
      }
      if (sub === "archetypes") {
        const items = ARCHETYPE_IDS.map((id) => ({
          id,
          title: DOMAIN_ARCHETYPES[id].title,
          summary: DOMAIN_ARCHETYPES[id].summary,
          defaultDensity: DOMAIN_ARCHETYPES[id].defaultDensity,
          defaultTheme: DOMAIN_ARCHETYPES[id].defaultTheme,
        }));
        if (asJson) {
          out(`${JSON.stringify({ archetypes: items }, null, 2)}\n`);
        } else {
          for (const item of items) {
            out(`${item.id.padEnd(20)} ${item.title} (${item.defaultDensity}, ${item.defaultTheme})\n`);
          }
        }
        return 0;
      }
      if (sub === "plan") {
        const domain = typeof flags.domain === "string" ? flags.domain : "enterprise-saas";
        const productName = typeof flags.name === "string" ? flags.name : "Untitled Product";
        const brief: Record<string, unknown> = { productName, domain };
        if (typeof flags.density === "string") brief.density = flags.density;
        if (typeof flags.theme === "string") brief.themePreference = flags.theme;
        if (typeof flags.audience === "string") brief.audience = flags.audience;
        const plan = planDesignDirections(brief);
        if (asJson) {
          out(`${JSON.stringify(plan, null, 2)}\n`);
        } else {
          out(`Product: ${plan.brief.productName} (${plan.archetype.title})\n`);
          out(`Recommended direction: ${plan.recommendedDirectionId}\n\n`);
          for (const dir of plan.directions) {
            out(`- ${dir.id}: ${dir.name}\n  ${dir.posture}\n  Tokens: ${dir.tokens.length}\n`);
          }
        }
        return 0;
      }
      if (sub === "skills") {
        const action = positionals[1] ?? "list";
        if (action === "list") {
          const query = typeof flags.query === "string" ? flags.query : "";
          const skills = listSkills(query);
          if (asJson) {
            out(`${JSON.stringify({ skills }, null, 2)}\n`);
          } else {
            for (const skill of skills) out(`${skill.id.padEnd(24)} ${skill.title} - ${skill.summary}\n`);
          }
          return 0;
        }
        if (action === "show" || action === "render") {
          const id = positionals[2];
          if (!id) {
            err(`ninerr design skills ${action}: specify a skill id\n`);
            return 2;
          }
          const skill = getSkill(id);
          if (!skill) {
            err(`ninerr design skills: unknown skill ${JSON.stringify(id)}\n`);
            return 2;
          }
          if (action === "render") {
            out(renderSkillMarkdown(skill));
          } else if (asJson) {
            out(`${JSON.stringify(skill, null, 2)}\n`);
          } else {
            out(`${skill.title} (${skill.id})\n${skill.summary}\nTools: ${skill.recommendedTools.join(", ")}\n`);
          }
          return 0;
        }
        err(`ninerr design skills: unknown action ${JSON.stringify(action)}\n${designHelp()}`);
        return 2;
      }
      if (sub === "archetype") {
        const id = positionals[1];
        if (!id) {
          err("ninerr design archetype: specify a domain id\n");
          return 2;
        }
        if (!Object.hasOwn(DOMAIN_ARCHETYPES, id)) {
          err(`ninerr design archetype: unknown domain id ${JSON.stringify(id)}; valid ids: ${ARCHETYPE_IDS.join(", ")}\n`);
          return 2;
        }
        const arch = getDomainArchetype(id);
        out(`${JSON.stringify(arch, null, 2)}\n`);
        return 0;
      }
      err(`ninerr design: unknown subcommand ${JSON.stringify(sub)}\n${designHelp()}`);
      return 2;
    }

    if (command === "motion") {
      const sub = positionals[0];
      if (!sub || sub === "help" || flags.help === true) {
        out(motionHelp());
        return 0;
      }
      if (sub === "presets") {
        const presets = MOTION_PRESET_IDS.map((id) => ({
          id,
          trigger: MOTION_PRESETS[id].trigger,
          duration: MOTION_PRESETS[id].duration,
          easing: MOTION_PRESETS[id].easing,
          properties: MOTION_PRESETS[id].properties,
          summary: MOTION_PRESETS[id].summary,
        }));
        if (asJson) {
          out(`${JSON.stringify({ tokens: MOTION_TOKENS, presets }, null, 2)}\n`);
        } else {
          for (const preset of presets) out(`${preset.id.padEnd(20)} ${preset.duration.padEnd(28)} ${preset.summary}\n`);
        }
        return 0;
      }
      if (sub === "compile") {
        const raw = typeof flags.presets === "string" ? flags.presets : positionals[1] ?? "";
        const presetIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
        if (presetIds.length === 0) {
          err("ninerr motion compile: pass --presets hover,focus,press\n");
          return 2;
        }
        const selector = typeof flags.selector === "string" ? flags.selector : ".ninerr-motion";
        const compiled = compileMotionStylesheet({ presetIds, selector });
        out(asJson ? `${JSON.stringify(compiled, null, 2)}\n` : `${compiled.css}\n`);
        return 0;
      }
      if (sub === "react") {
        const id = positionals[1];
        if (!id) {
          err("ninerr motion react: specify a preset id\n");
          return 2;
        }
        out(`${JSON.stringify(compileMotionReact(id), null, 2)}\n`);
        return 0;
      }
      if (sub === "lint") {
        const filePath = positionals[1];
        if (!filePath) {
          err("ninerr motion lint: specify a CSS file path\n");
          return 2;
        }
        const cssText = readBoundedTextFile(filePath, "ninerr motion lint");
        const findings = lintMotionCss(cssText, { allowAmbient: flags["allow-ambient"] === true });
        if (asJson) {
          out(`${JSON.stringify({ file: filePath, findings }, null, 2)}\n`);
        } else if (findings.length === 0) {
          out(`ok  ${filePath}: 0 motion issues\n`);
        } else {
          for (const f of findings) out(`${f.severity.toUpperCase().padEnd(8)} ${f.ruleId}: ${f.message}\n`);
        }
        return findings.some((f) => f.severity === "error") ? 1 : 0;
      }
      if (sub === "frequency") {
        const trigger = typeof flags.trigger === "string" ? flags.trigger : "";
        const presetId = typeof flags.preset === "string" ? flags.preset : "";
        const dailyUses = typeof flags["daily-uses"] === "string" ? Number(flags["daily-uses"]) : null;
        const result = evaluateMotionFrequency({ trigger, presetId, dailyUses: Number.isFinite(dailyUses) ? dailyUses : null });
        out(`${JSON.stringify(result, null, 2)}\n`);
        return result.allowed ? 0 : 1;
      }
      err(`ninerr motion: unknown subcommand ${JSON.stringify(sub)}\n${motionHelp()}`);
      return 2;
    }

    if (command === "components") {
      const sub = positionals[0];
      if (!sub || sub === "help" || flags.help === true) {
        out(componentsHelp());
        return 0;
      }
      if (sub === "list") {
        if (flags.category === true) {
          err("ninerr components list: --category requires a category value\n");
          return 2;
        }
        if (flags.query === true) {
          err("ninerr components list: --query requires a search query\n");
          return 2;
        }
        const category = typeof flags.category === "string" ? flags.category : "";
        const query = typeof flags.query === "string" ? flags.query : "";
        const components = searchNinerrComponents({ category, query });
        if (asJson) {
          out(`${JSON.stringify({ categories: NINERR_COMPONENT_CATEGORIES, components }, null, 2)}\n`);
        } else {
          for (const c of components) out(`${c.id.padEnd(22)} ${c.category.padEnd(22)} ${c.summary}\n`);
        }
        return 0;
      }
      if (sub === "show") {
        const raw = positionals[1];
        if (!raw) {
          err("ninerr components show: specify a component id\n");
          return 2;
        }
        const id = raw.startsWith("ninerr:") ? raw.slice(7) : raw;
        const component = getNinerrComponent(id);
        if (!component) {
          err(`ninerr components show: unknown component ${JSON.stringify(raw)}\n`);
          return 2;
        }
        if (asJson) {
          out(`${JSON.stringify(component, null, 2)}\n`);
        } else {
          out(`${component.name} (ninerr:${component.id}) [${component.category}]\n${component.summary}\nVariants: ${component.variants.join(", ")}\n`);
        }
        return 0;
      }
      err(`ninerr components: unknown subcommand ${JSON.stringify(sub)}\n${componentsHelp()}`);
      return 2;
    }

    if (command === "tokens") {
      const sub = positionals[0];
      if (!sub || sub === "help" || flags.help === true) {
        out(tokensHelp());
        return 0;
      }
      if (sub === "audit") {
        const projectDir = positionals[1];
        if (!projectDir) {
          err("ninerr tokens audit: specify a Ninerr project folder\n");
          return 2;
        }
        const opened = openProject(resolve(projectDir), { owner: "ninerr-cli-audit", at: new Date().toISOString() });
        let report;
        try {
          report = auditDesignSystem(opened.document);
        } finally {
          opened.close();
        }
        if (asJson) {
          out(`${JSON.stringify(report, null, 2)}\n`);
        } else {
          out(`Tokens: ${report.tokenCount} across ${report.collectionCount} collection(s), ${report.modeCount} mode(s)\n`);
          out(`Errors: ${report.summary.errors}, Warnings: ${report.summary.warnings}, Info: ${report.summary.info}\n`);
          for (const f of report.findings) out(`${f.severity.toUpperCase().padEnd(8)} ${f.ruleId}: ${f.message}\n`);
        }
        return report.summary.errors > 0 ? 1 : 0;
      }
      if (sub === "merge") {
        const basePath = typeof flags.base === "string" ? flags.base : "";
        const localPath = typeof flags.local === "string" ? flags.local : "";
        const upstreamPath = typeof flags.upstream === "string" ? flags.upstream : "";
        if (!basePath || !localPath || !upstreamPath) {
          err("ninerr tokens merge: specify --base, --local, and --upstream file paths\n");
          return 2;
        }
        const plan = planRegistryItemUpdate({
          baseContent: readBoundedTextFile(basePath, "ninerr tokens merge"),
          localContent: readBoundedTextFile(localPath, "ninerr tokens merge"),
          upstreamContent: readBoundedTextFile(upstreamPath, "ninerr tokens merge"),
        });
        if (asJson) {
          out(`${JSON.stringify(plan, null, 2)}\n`);
        } else if (plan.status === "conflict") {
          out(`CONFLICT (${plan.conflicts.length} conflict region(s))\n`);
        } else {
          out(`${plan.mergedContent}`);
        }
        return plan.status === "conflict" ? 1 : 0;
      }
      err(`ninerr tokens: unknown subcommand ${JSON.stringify(sub)}\n${tokensHelp()}`);
      return 2;
    }

    if (command === "preview" || command === "critique" || command === "audit" || command === "improve") {
      const lstatOrNull = (targetPath: string) => {
        try {
          return lstatSync(targetPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return null;
          throw error;
        }
      };
      const projectDir = positionals[0];
      if (!projectDir || projectDir === "help" || flags.help === true) {
        out(visionHelp());
        return 0;
      }
      if (flags.node === true) { err(`ninerr ${command}: --node requires a node id\n`); return 2; }
      if (flags.viewports === true) { err(`ninerr ${command}: --viewports requires a comma-separated viewport list\n`); return 2; }
      if (flags.out === true) { err(`ninerr ${command}: --out requires a directory path\n`); return 2; }
      if (flags.scheme === true) { err(`ninerr ${command}: --scheme requires light or dark\n`); return 2; }
      if (flags["max-iterations"] === true) { err(`ninerr ${command}: --max-iterations requires an integer from 1 to 5\n`); return 2; }

      const validVps = Object.keys(STANDARD_VIEWPORTS);
      const rawVps = [...new Set(
        typeof flags.viewports === "string"
          ? flags.viewports.split(",").map((s) => s.trim()).filter(Boolean)
          : ["mobile", "desktop"],
      )];
      if (rawVps.length === 0 || rawVps.some((v) => !validVps.includes(v))) {
        err(`ninerr ${command}: invalid viewports; valid ids: ${validVps.join(", ")}\n`);
        return 2;
      }
      const scheme = typeof flags.scheme === "string" ? flags.scheme : "light";
      if (scheme !== "light" && scheme !== "dark") {
        err(`ninerr ${command}: --scheme must be light or dark\n`);
        return 2;
      }
      const maxIterations = typeof flags["max-iterations"] === "string" ? Number(flags["max-iterations"]) : 3;
      if (command === "improve" && (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > 5)) {
        err("ninerr improve: --max-iterations must be an integer from 1 to 5\n");
        return 2;
      }

      const resolvedProject = resolve(projectDir);
      const opened = openProject(resolvedProject, { owner: `ninerr-cli-${command}`, at: new Date().toISOString() });
      try {
        const doc = opened.document as any;
        const explicitNode = typeof flags.node === "string" ? flags.node : null;
        if (explicitNode !== null && !Object.hasOwn(doc.nodes, explicitNode)) {
          err(`ninerr ${command}: node ${JSON.stringify(explicitNode)} not found\n`);
          return 2;
        }
        const targetNode = explicitNode ?? (doc.rootIds ?? []).find((id: string) => doc.nodes[id]?.type !== "design-system") ?? null;

        if (command === "preview") {
          if (!targetNode) {
            err("ninerr preview: project has no renderable frame or element\n");
            return 2;
          }
          // Validate output directory BEFORE launching Chromium.
          const isDefaultOut = typeof flags.out !== "string";
          const exportsDir = join(resolvedProject, "exports");
          const outDir = resolve(isDefaultOut ? join(exportsDir, "previews") : (flags.out as string));
          if (isDefaultOut) {
            for (const dir of [exportsDir, outDir]) {
              const st = lstatOrNull(dir);
              if (st !== null && (st.isSymbolicLink() || !st.isDirectory())) {
                err(`ninerr preview: ${dir} is a link or not a directory\n`);
                return 2;
              }
            }
          } else {
            const st = lstatOrNull(outDir);
            if (st !== null && (st.isSymbolicLink() || !st.isDirectory())) {
              err(`ninerr preview: ${outDir} is not a real directory\n`);
              return 2;
            }
          }

          let browserPath: string | null = null;
          try {
            browserPath = discoverBrowser();
          } catch (error) {
            err(`ninerr preview: ${error instanceof Error ? error.message : String(error)}\n`);
            return 1;
          }
          if (!browserPath) {
            err("ninerr preview: no local Chromium, Chrome, or Edge browser found (set NINERR_BROWSER)\n");
            return 1;
          }
          const { html } = exportHtml(doc, targetNode, { includeNodeIds: true });
          const rendered = await renderAndInspect({
            html,
            viewports: rawVps,
            colorScheme: scheme,
            reducedMotion: flags["reduced-motion"] === true ? "reduce" : "no-preference",
            captureScreenshot: true,
            fullPage: true,
            browserPath,
          });

          if (isDefaultOut) mkdirSync(exportsDir, { recursive: true, mode: 0o700 });
          mkdirSync(outDir, { recursive: true, mode: 0o700 });
          if (isDefaultOut) {
            for (const dir of [exportsDir, outDir]) {
              const st = lstatOrNull(dir);
              if (!st || st.isSymbolicLink() || !st.isDirectory()) {
                err(`ninerr preview: ${dir} is a link or not a directory\n`);
                return 2;
              }
            }
            if (realpathSync(outDir) !== join(realpathSync(resolvedProject), "exports", "previews")) {
              err("ninerr preview: default exports/previews resolves outside the project\n");
              return 2;
            }
          } else {
            const st = lstatOrNull(outDir);
            if (!st || st.isSymbolicLink() || !st.isDirectory()) {
              err(`ninerr preview: ${outDir} is not a real directory\n`);
              return 2;
            }
          }
          const realOutDir = realpathSync(outDir);
          const files = [];
          for (const cap of rendered.captures) {
            const p = join(realOutDir, `preview-${cap.viewport.id}.png`);
            const st = lstatOrNull(p);
            if (st !== null && (st.isSymbolicLink() || !st.isFile())) {
              err(`ninerr preview: refusing to overwrite symbolic link or non-regular file ${p}\n`);
              return 2;
            }
            writeTrustedBytes(p, cap.pngBuffer);
            files.push({ viewport: cap.viewport.id, path: p, bytes: cap.bytes, horizontalOverflow: cap.telemetry?.horizontalOverflow ?? false });
          }
          if (asJson) {
            out(`${JSON.stringify({ nodeId: targetNode, egressBlocked: rendered.egress.totalBlocked, files }, null, 2)}\n`);
          } else {
            for (const f of files) out(`ok  ${f.viewport.padEnd(16)} ${f.path} (${f.bytes} bytes)\n`);
          }
          return 0;
        }

        let visionBrowser: string | null = null;
        let visionNote: string | null = null;
        if (flags.vision === true) {
          try {
            visionBrowser = discoverBrowser();
            if (!visionBrowser) {
              visionNote = "No local Chromium/Chrome/Edge browser found; continuing with static analysis only.";
              err(`ninerr ${command}: warning: ${visionNote}\n`);
            }
          } catch (error) {
            visionNote = `${error instanceof Error ? error.message : String(error)}; continuing with static analysis only.`;
            err(`ninerr ${command}: warning: ${visionNote}\n`);
          }
        }
        const visionUsed = flags.vision === true && visionBrowser !== null;

        const evaluateDoc = async (candidate: any) => {
          const taste = evaluateTaste(candidate, { rootId: explicitNode });
          const sys = auditDesignSystem(candidate);
          let captures: any[] = [];
          if (visionUsed && visionBrowser) {
            const renderTarget = explicitNode ?? (candidate.rootIds ?? []).find((id: string) => candidate.nodes[id]?.type !== "design-system") ?? null;
            if (renderTarget) {
              const { html } = exportHtml(candidate, renderTarget, { includeNodeIds: true });
              const res = await renderAndInspect({ html, viewports: rawVps, colorScheme: scheme, captureScreenshot: false, browserPath: visionBrowser });
              captures = res.captures;
            }
          }
          return buildCritiqueReport({
            document: candidate,
            rootId: explicitNode,
            tasteFindings: taste.findings,
            systemFindings: sys.hasDesignSystem ? sys.findings : [],
            visionCaptures: captures,
          });
        };

        if (command === "critique" || command === "audit") {
          const report = await evaluateDoc(doc);
          if (asJson) {
            out(`${JSON.stringify({ visionUsed, ...(visionNote ? { visionNote } : {}), ...report }, null, 2)}\n`);
          } else {
            out(`Findings: ${report.summary.total} (errors: ${report.summary.errors}, warnings: ${report.summary.warnings}, info: ${report.summary.info}, score: ${report.summary.defectScore})\n`);
            for (const f of report.findings) out(`${f.severity.toUpperCase().padEnd(8)} [${f.kind}] ${f.ruleId}: ${f.message}\n`);
          }
          return report.summary.errors > 0 ? 1 : 0;
        }

        const improved = await improveDesignInMemory(doc, {
          maxIterations,
          evaluate: (candidate) => evaluateDoc(candidate),
        });
        let committedRevision: number | null = null;
        if (flags["dry-run"] !== true && improved.operations.length > 0) {
          const result = opened.commit({
            id: `tx-cli-improve-${randomUUID().slice(0, 12)}`,
            baseRevision: doc.revision,
            actor: "ninerr-cli",
            actorKind: "user",
            intent: `Improve design (${improved.baseline.defectScore} -> ${improved.final.defectScore})`,
            timestamp: new Date().toISOString(),
            operations: improved.operations,
          });
          committedRevision = result.revision;
        }
        if (asJson) {
          out(`${JSON.stringify({ ...improved, visionUsed, ...(visionNote ? { visionNote } : {}), dryRun: flags["dry-run"] === true, committedRevision }, null, 2)}\n`);
        } else {
          out(`Score: ${improved.baseline.defectScore} -> ${improved.final.defectScore} (${improved.iterationsRun} pass(es), ${improved.operations.length} node update(s)${flags["dry-run"] === true ? ", dry-run" : ""})\n`);
        }
        return 0;
      } finally {
        opened.close();
      }
    }

    if (command === "redesign") {
      const sub = positionals[0];
      if (!sub || sub === "help" || flags.help === true) {
        out([
          "Ninerr Existing-App Redesign CLI:",
          "  ninerr redesign inspect <workspace> [--json]",
          "  ninerr redesign plan <workspace> [--tokens <json-file>] [--classes <json-file>] [--files <a,b>] [--out <plan.json>] [--json]",
          "  ninerr redesign apply <workspace> --plan <plan.json> [--expected-token <sha>] [--journal <dir>] [--json]",
          "  ninerr redesign rollback <workspace> --run <runId> [--journal <dir>] [--force] [--json]",
        ].join("\n") + "\n");
        return 0;
      }
      const workspaceArg = positionals[1];
      if (!workspaceArg) {
        err(`ninerr redesign ${sub}: workspace folder path is required\n`);
        return 2;
      }
      const projectsPath = resolveProjectsFolder().path;
      const workspaceRoot = assertWorkspaceRoot(workspaceArg, projectsPath);
      const requireStringOption = (name: string): string | undefined => {
        if (!Object.hasOwn(flags, name)) return undefined;
        const val = flags[name];
        if (typeof val !== "string" || val.trim() === "") {
          throw new Error(`--${name} requires a non-empty value`);
        }
        return val.trim();
      };
      const defaultJournalDir = () => {
        const custom = requireStringOption("journal");
        return custom !== undefined ? resolve(custom) : join(projectsPath, ".ninerr-redesign-journals");
      };

      if (sub === "inspect") {
        const analysis = analyzeCodebase(workspaceRoot);
        if (asJson) {
          out(`${JSON.stringify(analysis, null, 2)}\n`);
        } else {
          out(`Workspace: ${analysis.workspaceRoot}\n`);
          out(`Project: ${analysis.projectName ?? "(unnamed)"}\n`);
          out(`Frameworks: ${analysis.frameworks.join(", ")}\n`);
          out(`Styling: ${analysis.styling.join(", ") || "none detected"}\n`);
          out(`Files: ${analysis.counts.scannedFiles} scanned (${analysis.counts.cssFiles} CSS, ${analysis.counts.componentFiles} code, ${analysis.counts.routeFiles} routes)\n`);
          out(`Contracts: ${analysis.counts.cssTokens} CSS tokens, ${analysis.counts.hooks} hooks, ${analysis.counts.handlers} handlers, ${analysis.counts.testIds} data-testid attrs\n`);
        }
        return 0;
      }

      if (sub === "plan") {
        const readJsonObject = (flagName: string): Record<string, string> => {
          const val = requireStringOption(flagName);
          if (val === undefined) return {};
          const parsed = JSON.parse(readBoundedTextFile(resolve(val), `ninerr redesign plan --${flagName}`));
          if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error(`--${flagName} must point to a JSON object`);
          }
          return parsed as Record<string, string>;
        };
        const cssTokenUpdates = readJsonObject("tokens");
        const jsxClassReplacements = readJsonObject("classes");
        const filesOpt = requireStringOption("files");
        const files = filesOpt !== undefined ? filesOpt.split(",").map((s) => s.trim()).filter(Boolean) : [];
        if (Object.keys(cssTokenUpdates).length === 0 && Object.keys(jsxClassReplacements).length === 0) {
          err("ninerr redesign plan: provide --tokens <json-file> and/or --classes <json-file>\n");
          return 2;
        }
        const plan = planRedesign(workspaceRoot, { cssTokenUpdates, jsxClassReplacements, files });
        let outFile: string | null = null;
        const outOpt = requireStringOption("out");
        if (outOpt !== undefined) {
          const target = assertNoSymlinkPath(resolve(outOpt), "--out path");
          let targetStat = null;
          try { targetStat = lstatSync(target); } catch (e) { if ((e as NodeJS.ErrnoException)?.code !== "ENOENT") throw e; }
          if (targetStat !== null && (targetStat.isSymbolicLink() || targetStat.isDirectory())) {
            throw new Error(`--out ${JSON.stringify(outOpt)} must not be a symlink or directory`);
          }
          const parent = dirname(target);
          mkdirSync(parent, { recursive: true, mode: 0o700 });
          writeTrustedFile(target, `${JSON.stringify(plan, null, 2)}\n`);
          outFile = target;
        }
        if (asJson) {
          out(`${JSON.stringify({
            planToken: plan.planToken,
            workspaceRoot: plan.workspaceRoot,
            ...(outFile ? { planFile: outFile } : {}),
            fileCount: plan.patches.length,
            files: plan.patches.map(({ file, tier, beforeSha256, afterSha256, summary }) => ({ file, tier, beforeSha256, afterSha256, summary })),
          }, null, 2)}\n`);
        } else {
          out(`Plan token: ${plan.planToken}\n`);
          out(`Files to patch: ${plan.patches.length}${outFile ? ` (written to ${outFile})` : ""}\n`);
          for (const p of plan.patches) out(`  [tier ${p.tier}] ${p.file} — ${p.summary}\n`);
        }
        return 0;
      }

      if (sub === "apply") {
        const planPath = requireStringOption("plan");
        if (planPath === undefined) {
          err("ninerr redesign apply: --plan <plan.json> is required\n");
          return 2;
        }
        const expectedToken = requireStringOption("expected-token");
        if (expectedToken !== undefined && !/^[a-f0-9]{64}$/u.test(expectedToken)) {
          err("ninerr redesign apply: --expected-token must be a 64-character SHA-256 hex digest\n");
          return 2;
        }
        const plan = JSON.parse(readBoundedTextFile(resolve(planPath), "ninerr redesign apply --plan"));
        if (!plan || typeof plan !== "object" || plan.workspaceRoot !== workspaceRoot) {
          err("ninerr redesign apply: plan workspaceRoot does not match the specified workspace folder\n");
          return 2;
        }
        const applied = applyRedesignPlan(plan, { journalDir: defaultJournalDir(), ...(expectedToken !== undefined ? { expectedPlanToken: expectedToken } : {}) });
        if (asJson) {
          out(`${JSON.stringify(applied, null, 2)}\n`);
        } else {
          out(`Applied ${applied.filesApplied.length} file(s) — runId: ${applied.runId}\n`);
          for (const f of applied.filesApplied) out(`  [tier ${f.tier}] ${f.file} — ${f.summary}\n`);
          out(`Rollback journal: ${applied.journalPath}\n`);
        }
        return 0;
      }

      if (sub === "rollback") {
        const runId = requireStringOption("run");
        if (runId === undefined) {
          err("ninerr redesign rollback: --run <runId> is required\n");
          return 2;
        }
        const rolled = rollbackRedesign({
          workspaceRoot,
          journalDir: defaultJournalDir(),
          runId,
          force: flags.force === true,
        });
        if (asJson) {
          out(`${JSON.stringify(rolled, null, 2)}\n`);
        } else {
          out(`Rolled back ${rolled.restoredFiles.length} file(s) from ${rolled.runId}:\n`);
          for (const f of rolled.restoredFiles) out(`  restored ${f}\n`);
        }
        return 0;
      }

      err(`ninerr redesign: unknown subcommand ${JSON.stringify(sub)}\n`);
      return 2;
    }

    err(`ninerr: unknown command ${JSON.stringify(command)}\n`);
    return 2;
  } catch (error) {
    err(`ninerr ${command}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
