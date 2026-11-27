// W3C Design Tokens Community Group (DTCG) JSON import and export for Ninerr's schema v2
// design-system node. Pure offline parsing with bounded depth, token count, null-prototype
// maps, and CSS value validation through @ninerr/document-model; zero external dependencies.
import { SCHEMA_V2_LIMITS, TOKEN_NAME, TOKEN_TYPES, cssValueProblem, designSystemOf } from "@ninerr/document-model";
import { StudioError } from "./errors.ts";
import { planItemTokens } from "./component-import.ts";

export const MAX_DTCG_BYTES = 1024 * 1024;
const MAX_DTCG_DEPTH = 16;
const MAX_DTCG_TOKENS = 5_000;
const MAX_SHADOW_LAYERS = 16;

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
const cleanFileName = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, " ").trim().slice(0, 200);

function slugPath(segments: string[]): string {
  return segments
    .join("-")
    .replace(/[^A-Za-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 127);
}

function serializeScalarValue(value: unknown, collectionPrefixes: ReadonlySet<string>): string | null {
  if (typeof value === "string") {
    let invalidAlias = false;
    const replaced = value.replace(ALIAS_PATTERN, (_match, ref: string) => {
      const parts = ref.split(".");
      const normalized = parts.length > 1 && collectionPrefixes.has(parts[0]) ? parts.slice(1) : parts;
      const slug = slugPath(normalized);
      if (slug === "" || !TOKEN_NAME.test(`--${slug}`)) {
        invalidAlias = true;
        return "";
      }
      return `var(--${slug})`;
    });
    return invalidAlias ? null : replaced;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every((entry) => typeof entry === "string")) {
    return value.map((font) => (/\s/u.test(font) && !/^["']/u.test(font) ? `"${font.replace(/"/gu, "")}"` : font)).join(", ");
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    // DTCG dimension object: { value: 16, unit: "px" }
    if (typeof obj.value === "number" && Number.isFinite(obj.value) && typeof obj.unit === "string" && /^[a-z%]{1,8}$/iu.test(obj.unit)) {
      return `${obj.value}${obj.unit}`;
    }
    // DTCG 2025.10 color object with hex string
    if (typeof obj.hex === "string" && /^#[0-9a-f]{3,8}$/iu.test(obj.hex)) {
      return obj.hex;
    }
  }
  return null;
}

function serializeShadowLayer(value: unknown, collectionPrefixes: ReadonlySet<string>): string | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (obj.offsetX === undefined || obj.offsetY === undefined || obj.color === undefined) return null;
  const ox = serializeScalarValue(obj.offsetX, collectionPrefixes);
  const oy = serializeScalarValue(obj.offsetY, collectionPrefixes);
  const blur = obj.blur === undefined ? "0px" : serializeScalarValue(obj.blur, collectionPrefixes);
  const spread = obj.spread === undefined ? undefined : serializeScalarValue(obj.spread, collectionPrefixes);
  const color = serializeScalarValue(obj.color, collectionPrefixes);
  if (obj.inset !== undefined && typeof obj.inset !== "boolean") return null;
  if (!ox || !oy || !blur || !color) return null;
  if (obj.spread !== undefined && !spread) return null;
  return [...(obj.inset === true ? ["inset"] : []), ox, oy, blur, ...(spread ? [spread] : []), color].join(" ");
}

function serializeDtcgValue(value: unknown, collectionPrefixes: ReadonlySet<string>): string | null {
  const scalar = serializeScalarValue(value, collectionPrefixes);
  if (scalar !== null) return scalar;
  if (Array.isArray(value) && value.length > 0 && value.length <= MAX_SHADOW_LAYERS) {
    const layers = value.map((entry) => serializeShadowLayer(entry, collectionPrefixes));
    if (layers.every((layer): layer is string => layer !== null)) return layers.join(", ");
    return null;
  }
  return serializeShadowLayer(value, collectionPrefixes);
}

function mapDtcgType(ownType: string | null): string | null {
  if (ownType === null) return null;
  if (Object.hasOwn(DTCG_TYPE_MAP, ownType)) return DTCG_TYPE_MAP[ownType];
  if (TOKEN_TYPES.includes(ownType as any)) return ownType;
  return null;
}

export interface ParsedDtcg {
  source: "dtcg";
  theme: Record<string, string>;
  light: Record<string, string>;
  dark: Record<string, string>;
  types: Record<string, string>;
  descriptions: Record<string, string>;
  kept: Array<{ name: string; value: string; reason: string }>;
  skipped: number;
}

/** Parse a W3C DTCG JSON token document into light/dark CSS custom property maps with preserved types. */
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

  const rootObj = root as Record<string, unknown>;
  const rootExt = rootObj.$extensions !== null && typeof rootObj.$extensions === "object" && !Array.isArray(rootObj.$extensions)
    ? (rootObj.$extensions as Record<string, unknown>)
    : null;
  const ninerrExt = rootExt && rootExt.ninerr !== null && typeof rootExt.ninerr === "object" && !Array.isArray(rootExt.ninerr)
    ? (rootExt.ninerr as Record<string, unknown>)
    : null;
  const groupedByCollection = ninerrExt?.groupedByCollection === true;
  const collectionPrefixes = new Set<string>();
  if (groupedByCollection) {
    for (const [k, child] of Object.entries(rootObj)) {
      if (!k.startsWith("$") && child !== null && typeof child === "object" && !Array.isArray(child) && !Object.hasOwn(child, "$value")) {
        collectionPrefixes.add(k);
      }
    }
  }

  const theme: Record<string, string> = Object.create(null);
  const light: Record<string, string> = Object.create(null);
  const dark: Record<string, string> = Object.create(null);
  const types: Record<string, string> = Object.create(null);
  const descriptions: Record<string, string> = Object.create(null);
  const kept: Array<{ name: string; value: string; reason: string }> = [];
  let count = 0;
  let skipped = 0;

  const walk = (node: Record<string, unknown>, path: string[], inheritedType: string | null, depth: number) => {
    if (depth > MAX_DTCG_DEPTH) throw new StudioError(422, "token-json-refused", `token JSON exceeds maximum nesting depth of ${MAX_DTCG_DEPTH}`);
    const ownType = typeof node.$type === "string" ? node.$type : inheritedType;
    if (Object.hasOwn(node, "$value")) {
      count += 1;
      if (count > MAX_DTCG_TOKENS) throw new StudioError(422, "token-json-refused", `token JSON exceeds ${MAX_DTCG_TOKENS} tokens`);
      const effectivePath = groupedByCollection && path.length > 1 && collectionPrefixes.has(path[0]) ? path.slice(1) : path;
      const key = slugPath(effectivePath);
      if (key === "" || !TOKEN_NAME.test(`--${key}`)) {
        skipped += 1;
        return;
      }
      const mappedType = mapDtcgType(ownType);
      if (ownType !== null && mappedType === null) {
        kept.push({ name: `--${key}`, value: String(ownType), reason: `unsupported DTCG $type ${ownType}` });
        return;
      }
      const primary = serializeDtcgValue(node.$value, collectionPrefixes);
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
      const hasDark = modeMap !== null && Object.hasOwn(modeMap, "dark");
      const darkRaw = hasDark ? serializeDtcgValue(modeMap.dark, collectionPrefixes) : null;
      if (hasDark && (darkRaw === null || cssValueProblem(darkRaw) !== null)) {
        skipped += 1;
        return;
      }
      // Clear any earlier bucket on slug collision so stale mode values never leak across tokens.
      delete theme[key];
      delete light[key];
      delete dark[key];
      if (hasDark && darkRaw !== null) {
        light[key] = primary;
        dark[key] = darkRaw;
      } else {
        theme[key] = primary;
      }
      if (mappedType !== null) types[key] = mappedType;
      if (typeof node.$description === "string" && node.$description.trim() !== "") {
        descriptions[key] = node.$description.trim().slice(0, SCHEMA_V2_LIMITS.textLength);
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

  walk(rootObj, [], null, 0);
  kept.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { source: "dtcg", theme, light, dark, types, descriptions, kept, skipped };
}

/** Plan adding W3C DTCG JSON tokens to `document` without overwriting existing tokens. */
export function planDtcgTokens(document: any, jsonText: string, fileName?: string) {
  const parsed = parseDtcgTokens(jsonText);
  const planned = planItemTokens(document, parsed);
  const adds = planned.tokens.filter((token) => token.status === "new" || token.status === "extended").length;
  const safeFile = typeof fileName === "string" && cleanFileName(fileName) !== "" ? cleanFileName(fileName) : null;
  return {
    plan: {
      fileName: safeFile,
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

/** Mask CSS quoted strings and comments with spaces (preserving length) so var() inside strings is ignored. */
function cssOutsideStrings(text: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (; i < stop; i += 1) out.push(" ");
      continue;
    }
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      out.push(ch);
      i += 1;
      while (i < text.length && text[i] !== ch && text[i] !== "\n") {
        const w = text[i] === "\\" ? 2 : 1;
        for (let step = 0; step < w && i < text.length; step += 1, i += 1) out.push(" ");
      }
      if (i < text.length && text[i] === ch) {
        out.push(ch);
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

/** Rewrite var(--name) tokens outside CSS strings/comments into DTCG {path} references. */
function cssToDtcgValue(value: string, targetPathFor: (name: string) => string): string {
  const code = cssOutsideStrings(value);
  const pattern = /(?<![\w-])var\(\s*(--[A-Za-z0-9_-]{1,127})\s*\)/giu;
  let result = "";
  let cursor = 0;
  for (const match of code.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    result += value.slice(cursor, start);
    result += `{${targetPathFor(match[1])}}`;
    cursor = end;
  }
  return result + value.slice(cursor);
}

/** Export the open document's design system as a deterministic W3C DTCG JSON string. */
export function exportDtcgTokens(document: any): string {
  const system = designSystemOf(document);
  if (system === null || system.props.tokens.length === 0) {
    throw new StudioError(422, "no-tokens", "this project has no design tokens to export");
  }
  const collections = new Map<string, any>(system.props.collections.map((col: any) => [col.id, col]));
  const sorted = [...system.props.tokens].sort((a: any, b: any) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const usedCollections = new Set<string>(sorted.map((token: any) => String((collections.get(token.collection) ?? system.props.collections[0]).id)));
  const grouped = usedCollections.size > 1;
  const collectionByToken = new Map<string, string>(
    sorted.map((token: any) => [String(token.name), String((collections.get(token.collection) ?? system.props.collections[0]).id)]),
  );

  const root: Record<string, any> = Object.create(null);
  root.$description = `Ninerr design tokens (${system.props.name})`;
  if (grouped) {
    root.$extensions = { ninerr: { groupedByCollection: true } };
  }

  const targetPathFor = (tokenName: string): string => {
    const bare = tokenName.replace(/^--/u, "");
    if (!grouped) return bare;
    const col = collectionByToken.get(tokenName);
    return col ? `${col}.${bare}` : bare;
  };

  for (const token of sorted) {
    const collection = collections.get(token.collection) ?? system.props.collections[0];
    const defaultMode: string = collection.defaultMode;
    const rawKey = String(token.name).replace(/^--/u, "");
    const colKey = String(collection.id);
    const primary = token.values[defaultMode] ?? Object.values(token.values)[0] ?? "";
    const entry: Record<string, unknown> = Object.create(null);
    entry.$type = token.type;
    entry.$value = cssToDtcgValue(String(primary), targetPathFor);
    if (typeof token.description === "string" && token.description !== "") entry.$description = token.description;
    const extraModes: Record<string, string> = Object.create(null);
    for (const modeId of Object.keys(token.values as Record<string, string>).sort()) {
      if (modeId !== defaultMode) {
        extraModes[modeId] = cssToDtcgValue(String(token.values[modeId]), targetPathFor);
      }
    }
    if (Object.keys(extraModes).length > 0) entry.$extensions = { modes: extraModes };
    if (grouped) {
      if (!Object.hasOwn(root, colKey)) root[colKey] = Object.create(null);
      root[colKey][rawKey] = entry;
    } else {
      root[rawKey] = entry;
    }
  }
  return `${JSON.stringify(root, null, 2)}\n`;
}
