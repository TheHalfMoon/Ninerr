// Extended Ninerr CLI subcommands dispatched from bin/ninerr.mjs (`ninerr design ...`,
// `ninerr motion ...`, and subsequent product commands). Pure local execution, zero network.
import { readFileSync } from "node:fs";
import {
  ARCHETYPE_IDS,
  DOMAIN_ARCHETYPES,
  MOTION_PRESETS,
  MOTION_PRESET_IDS,
  MOTION_TOKENS,
  compileMotionReact,
  compileMotionStylesheet,
  evaluateMotionFrequency,
  getDomainArchetype,
  getSkill,
  lintMotionCss,
  listSkills,
  planDesignDirections,
  renderSkillMarkdown,
} from "@ninerr/design-intelligence";

export interface CliRunOptions {
  version: string;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export const EXTENDED_CLI_COMMANDS = Object.freeze(["design", "motion"]);

function parseFlags(argv: string[]) {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = Object.create(null);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const eq = token.indexOf("=");
      if (eq > 2) {
        flags[token.slice(2, eq)] = token.slice(eq + 1);
      } else {
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          flags[key] = next;
          i += 1;
        } else {
          flags[key] = true;
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
        const cssText = readFileSync(filePath, "utf8");
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

    err(`ninerr: unknown command ${JSON.stringify(command)}\n`);
    return 2;
  } catch (error) {
    err(`ninerr ${command}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}
