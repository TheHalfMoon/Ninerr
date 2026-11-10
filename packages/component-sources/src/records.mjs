// Normalized component records: one schema for the components of every catalog source, so a
// person or an agent can search, inspect and compare them in one place. A source's records are
// generated from its pinned source and committed beside this file (<source>-records.mjs); they are metadata, never
// component code Ninerr runs. Records load on demand (the editor and the host import this file).

/** Meta Astryx, pinned: the commit its records were generated from (docs/provenance/ASTRYX_SOURCE_AUDIT.md). */
export const ASTRYX = Object.freeze({
  id: "astryx",
  repository: "https://github.com/meta/astryx",
  commit: "2309691dba9533635259113316a2cb14ec832933",
});

// The sources with records, and how to load them.
const RECORD_SETS = Object.freeze({
  [ASTRYX.id]: () => import("./astryx-records.mjs"),
});

export const RECORD_SOURCES = Object.freeze(Object.keys(RECORD_SETS));
export const RENDERING = Object.freeze(["server-safe", "client"]);
export const COMPONENT_RECORD_FIELDS = Object.freeze([
  "id", "source", "name", "description", "category", "subComponentOf", "keywords", "framework", "styling",
  "importPath", "dependencies", "props", "variants", "accessibility", "guidance", "themes", "themingTargets",
  "examples", "rendering", "limitations", "sourceFiles", "tests", "doc", "status",
]);

const isString = (value) => typeof value === "string";
const isStringOrNull = (value) => value === null || typeof value === "string";
const isStrings = (value) => Array.isArray(value) && value.every(isString);
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const SHA256 = /^[0-9a-f]{64}$/u;

/** Why `record` is not a normalized component record of `source`, or null when it is one. */
export function componentRecordProblem(record, source) {
  if (!isRecord(record)) return "a record is an object";
  const fields = Object.keys(record);
  const extra = fields.filter((field) => !COMPONENT_RECORD_FIELDS.includes(field));
  const missing = COMPONENT_RECORD_FIELDS.filter((field) => !Object.hasOwn(record, field));
  if (extra.length > 0 || missing.length > 0) return `fields: ${[...missing.map((field) => `missing ${field}`), ...extra.map((field) => `unknown ${field}`)].join(", ")}`;
  if (record.source !== source || record.id !== `${source}:${record.name}`) return `${String(record.id)}: its id is ${source}:<name>`;
  for (const field of ["name", "description", "framework", "styling", "status"]) if (!isString(record[field])) return `${record.id}: ${field} is text`;
  for (const field of ["category", "subComponentOf", "importPath"]) if (!isStringOrNull(record[field])) return `${record.id}: ${field} is text or null`;
  for (const field of ["keywords", "themes", "themingTargets", "limitations", "sourceFiles", "tests"]) if (!isStrings(record[field])) return `${record.id}: ${field} is a list of text`;
  if (!isRecord(record.dependencies) || !Object.values(record.dependencies).every(isString)) return `${record.id}: dependencies map names to versions`;
  if (!RENDERING.includes(record.rendering)) return `${record.id}: rendering is ${RENDERING.join(" or ")}`;
  if (!Array.isArray(record.props)) return `${record.id}: props is a list`;
  for (const prop of record.props) {
    if (!isRecord(prop) || !isString(prop.name) || !isString(prop.type) || typeof prop.required !== "boolean" || !isStringOrNull(prop.default) || !isString(prop.description)) return `${record.id}: a prop has name, type, required, default and description`;
    if (prop.values !== null && !isStrings(prop.values)) return `${record.id}: prop ${prop.name}'s values are a list of text or null`;
  }
  if (!Array.isArray(record.variants) || !record.variants.every((variant) => isRecord(variant) && record.props.some((prop) => prop.name === variant.prop && prop.values !== null) && isStrings(variant.values))) return `${record.id}: each variant is a prop with listed values`;
  if (!Array.isArray(record.accessibility) || !record.accessibility.every((item) => isRecord(item) && isString(item.name) && isString(item.description))) return `${record.id}: accessibility entries have a name and a description`;
  if (!Array.isArray(record.guidance) || !record.guidance.every((item) => isRecord(item) && typeof item.do === "boolean" && isString(item.text))) return `${record.id}: guidance entries say do or don't`;
  if (!Array.isArray(record.examples) || !record.examples.every((item) => isRecord(item) && isString(item.label) && isString(item.code))) return `${record.id}: examples have a label and code`;
  if (!isRecord(record.doc) || !isString(record.doc.path) || !SHA256.test(record.doc.sha256)) return `${record.id}: doc names its source file and its sha256`;
  if (!record.sourceFiles.every((path) => !path.startsWith("/") && !path.split("/").includes(".."))) return `${record.id}: source files are paths inside the source`;
  return null;
}

const cache = new Map();
/** The pinned snapshot of `sourceId`'s records: { source, repository, commit, package, license, components }. */
export async function loadComponentRecords(sourceId) {
  if (!Object.hasOwn(RECORD_SETS, sourceId)) throw new Error(`No component records for ${String(sourceId)}`);
  if (!cache.has(sourceId)) cache.set(sourceId, RECORD_SETS[sourceId]().then((module) => module.default));
  return cache.get(sourceId);
}

const words = (value) => String(value ?? "").toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The records matching `query` (words, any order), best first: a name match, then a keyword,
 * then the category, then the description and props. Filters by category and source.
 */
export function searchComponents(records, { query = "", category = null, limit = 50 } = {}) {
  const terms = words(String(query).slice(0, 200));
  const scored = [];
  for (const record of records) {
    if (category !== null && record.category !== category) continue;
    const name = record.name.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (name === term) score += 100;
      else if (name.startsWith(term)) score += 40;
      else if (name.includes(term)) score += 25;
      else if (record.keywords.some((keyword) => words(keyword).includes(term))) score += 20;
      else if (words(record.category).includes(term)) score += 10;
      else if (record.description.toLowerCase().includes(term) || record.props.some((prop) => prop.name.toLowerCase().includes(term))) score += 3;
      else {
        score = 0;
        break;
      }
    }
    if (terms.length === 0 || score > 0) scored.push({ record, score: terms.length === 0 ? 0 : score });
  }
  scored.sort((a, b) => b.score - a.score || (a.record.name < b.record.name ? -1 : a.record.name > b.record.name ? 1 : 0));
  return scored.slice(0, Math.max(0, Math.min(limit, 200))).map((entry) => entry.record);
}
