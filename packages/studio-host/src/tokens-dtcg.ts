// W3C Design Tokens Community Group (DTCG) JSON import and export for Ninerr's schema v2
// design-system node. Pure offline parsing with bounded depth, token count, and CSS value
// validation through @ninerr/document-model; zero external dependencies.
import { TOKEN_NAME, TOKEN_TYPES, cssValueProblem, designSystemOf } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";
import { planItemTokens } from "./component-import.ts";

export const MAX_DTCG_BYTES = 1024 * 1024;
const MAX_DTCG_DEPTH = 16;
const MAX_DTCG_TOKENS = 5_000;

const DTCG_TYPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  color: "color",
  dimension: "spacing",
  spacing: "spacing",
  radius: "radius",
  borderRadius: "radius",
  fontFamily: "fontFamily",
  fontSize: "fontSize",
  fontWeight: "fontWeight",
  lineHeight: "lineHeight",
  letterSpacing: "letterSpacing",
  opacity: "opacity",
  shadow: "shadow",
  breakpoint: "breakpoint",
});

const ALIAS_PATTERN = /\{([A-Za-z0-9_.-]+)\}/gu;

function slugPath(segments: string[]): string {
  return segments
    .join("-")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 127);
}

function serializeDtcgValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value.replace(ALIAS_PATTERN, (_match, ref: string) => `var(--${slugPath(ref.split("."))})`);
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
    return value.map((font) => (/\s/u.test(font) && !/^["']/u.test(font) ? `"${font.replace(/"/gu, "")}"` : font)).join(", ");
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    // DTCG dimension object: { value: 16, unit: "px" }
    if (typeof obj.value === "number" && Number.isFinite(obj.value) && typeof obj.unit === "string" && /^[a-z%]{1,8}$/iu.test(obj.unit)) {
      return `${obj.value}${obj.unit}`;
    }
    // DTCG shadow object: { offsetX, offsetY, blur, spread, color }
    if (obj.offsetX !== undefined && obj.offsetY !== undefined && obj.color !== undefined) {
      const ox = serializeDtcgValue(obj.offsetX);
      const oy = serializeDtcgValue(obj.offsetY);
      const blur = obj.blur === undefined ? "0px" : serializeDtcgValue(obj.blur);
      const spread = obj.spread === undefined ? null : serializeDtcgValue(obj.spread);
      const color = serializeDtcgValue(obj.color);
      if (ox && oy && blur && color) return [ox, oy, blur, ...(spread ? [spread] : []), color].join(" ");
    }
  }
  return null;
}

export interface ParsedDtcg {
  source: "dtcg";
  theme: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
  kept: string[];
  skipped: number;
}

/** Parse a W3C DTCG JSON token document into light/dark CSS custom property maps. */
export function parseDtcgTokens(jsonText: string): ParsedDtcg {
  if (typeof jsonText !== "string" || jsonText.trim() === "") throw new StudioError(400, "invalid-token-json", "source must be a non-empty JSON string");
  if (Buffer.byteLength(jsonText, "utf8") > MAX_DTCG_BYTES) throw new StudioError(413, "token-json-too-large", `token JSON is limited to ${MAX_DTCG_BYTES / 1024} KiB`);
  let root: unknown;
  try {
    root = JSON.parse(jsonText);
  } catch {
    throw new StudioError(422, "token-json-refused", "source is not valid JSON");
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    throw new StudioError(422, "token-json-refused", "token JSON root must be an object");
  }

  const theme: Record<string, string> = {};
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  const kept: string[] = [];
  let count = 0;
  let skipped = 0;

  const walk = (node: Record<string, unknown>, path: string[], inheritedType: string | null, depth: number) => {
    if (depth > MAX_DTCG_DEPTH) throw new StudioError(422, "token-json-refused", `token JSON exceeds maximum nesting depth of ${MAX_DTCG_DEPTH}`);
    const ownType = typeof node.$type === "string" ? node.$type : inheritedType;
    if (Object.hasOwn(node, "$value")) {
      count += 1;
      if (count > MAX_DTCG_TOKENS) throw new StudioError(422, "token-json-refused", `token JSON exceeds ${MAX_DTCG_TOKENS} tokens`);
      const key = slugPath(path);
      if (key === "" || !TOKEN_NAME.test(`--${key}`)) {
        skipped += 1;
        return;
      }
      if (ownType !== null && !Object.hasOwn(DTCG_TYPE_MAP, ownType) && !TOKEN_TYPES.includes(ownType as any)) {
        kept.push(`--${key}`);
        return;
      }
      const primary = serializeDtcgValue(node.$value);
      if (primary === null || cssValueProblem(primary) !== null) {
        skipped += 1;
        return;
      }
      const ext = node.$extensions !== null && typeof node.$extensions === "object" && !Array.isArray(node.$extensions)
        ? (node.$extensions as Record<string, unknown>)
        : null;
      const modeMap = ext && ext.modes !== null && typeof ext.modes === "object" && !Array.isArray(ext.modes)
        ? (ext.modes as Record<string, unknown>)
        : ext && ext.mode !== null && typeof ext.mode === "object" && !Array.isArray(ext.mode)
          ? (ext.mode as Record<string, unknown>)
          : null;
      const darkRaw = modeMap && Object.hasOwn(modeMap, "dark") ? serializeDtcgValue(modeMap.dark) : null;
      if (darkRaw !== null && cssValueProblem(darkRaw) === null) {
        light[key] = primary;
        dark[key] = darkRaw;
      } else {
        theme[key] = primary;
      }
      return;
    }
    for (const [k, child] of Object.entries(node)) {
      if (k.startsWith("$")) continue;
      if (child !== null && typeof child === "object" && !Array.isArray(child)) {
        walk(child as Record<string, unknown>, [...path, k], ownType, depth + 1);
      }
    }
  };

  walk(root as Record<string, unknown>, [], null, 0);
  return { source: "dtcg", theme, light, dark, kept: kept.sort(), skipped };
}

/** Plan adding W3C DTCG JSON tokens to `document` without overwriting existing tokens. */
export function planDtcgTokens(document: any, jsonText: string, fileName?: string) {
  const parsed = parseDtcgTokens(jsonText);
  const planned = planItemTokens(document, parsed);
  const adds = planned.tokens.filter((token) => token.status === "new" || token.status === "extended").length;
  return {
    plan: {
      fileName: fileName ?? null,
      source: parsed.source,
      tokens: planned.tokens,
      kept: parsed.kept,
      skipped: parsed.skipped,
      problem: planned.problem,
      adds,
    },
    operations: planned.operations,
  };
}

/** Export the open document's design system as a deterministic W3C DTCG JSON string. */
export function exportDtcgTokens(document: any): string {
  const system = designSystemOf(document);
  if (system === null || system.props.tokens.length === 0) {
    throw new StudioError(422, "no-tokens", "this project has no design tokens to export");
  }
  const collections = new Map<string, any>(system.props.collections.map((col: any) => [col.id, col]));
  const root: Record<string, any> = {
    $description: `Ninerr design tokens (${system.props.name})`,
  };
  const sorted = [...system.props.tokens].sort((a: any, b: any) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const token of sorted) {
    const collection = collections.get(token.collection) ?? system.props.collections[0];
    const defaultMode: string = collection.defaultMode;
    const rawKey = String(token.name).replace(/^--/u, "");
    const colKey = String(collection.id);
    if (!Object.hasOwn(root, colKey)) root[colKey] = {};
    const primary = token.values[defaultMode] ?? Object.values(token.values)[0] ?? "";
    const toDtcg = (val: string) => val.replace(/var\(\s*--([A-Za-z0-9_-]+)\s*\)/gu, (_m, name: string) => `{${colKey}.${name}}`);
    const entry: Record<string, unknown> = {
      $type: token.type,
      $value: toDtcg(String(primary)),
    };
    if (typeof token.description === "string" && token.description !== "") entry.$description = token.description;
    const extraModes: Record<string, string> = {};
    for (const [modeId, modeVal] of Object.entries(token.values as Record<string, string>)) {
      if (modeId !== defaultMode) extraModes[modeId] = toDtcg(String(modeVal));
    }
    if (Object.keys(extraModes).length > 0) entry.$extensions = { modes: extraModes };
    root[colKey][rawKey] = entry;
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}
