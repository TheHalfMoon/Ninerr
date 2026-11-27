// Ninerr Research: offline pattern extraction, rights-aware portable local reference packs,
// and strictly human-invoked CLI-only URL metric capture (NEVER exposed via MCP, zero silent egress).

import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { join } from "node:path";
import { normalizeReferencePack, referencePackDigest, withoutUnsafeText } from "@ninerr/import-stack";
import { classifyAddress } from "@ninerr/network-policy";
import { StudioError } from "./errors.ts";
import { assertNoSymlinkPath, extractCssCustomProperties } from "./redesign.ts";
import { writeTrustedFile } from "./trusted-file.ts";

export const RESEARCH_LIMITS = Object.freeze({
  maxInputBytes: 512 * 1024,
  maxEntries: 64,
  maxCaptureBytes: 512 * 1024,
  captureTimeoutMs: 10_000,
  maxPacksListed: 200,
});

const PACK_FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}\.json$/u;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const SAFE_TAG = /^[a-z0-9][a-z0-9._/-]{0,31}$/u;
const OBJECT_KINDS = new Set(["screen", "flow", "pattern", "asset", "token", "component"]);
const ALLOWED_CAPTURE_MIME = /^(?:text\/html|application\/xhtml\+xml|text\/css)(?:\s*;|$)/iu;
const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function lstatOrNull(targetPath: string) {
  try {
    return lstatSync(targetPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    throw error;
  }
}

/**
 * Create `dirPath` owner-only (`0o700`) and prove AFTER `mkdirSync` that neither the directory
 * nor any ancestor component is a user symlink (closing post-mkdir symlink TOCTOU while staying
 * compatible with Windows 8.3 short path spellings like `RUNNER~1`).
 */
export function ensureRealDirectory(dirPath: string, label: string): string {
  const safeDir = assertNoSymlinkPath(dirPath, label);
  const existing = lstatOrNull(safeDir);
  if (existing !== null && (existing.isSymbolicLink() || !existing.isDirectory())) {
    throw new StudioError(409, "symlink-refused", `${label} is not a regular directory`);
  }
  mkdirSync(safeDir, { recursive: true, mode: 0o700 });
  // Re-walk every ancestor and leaf component AFTER mkdirSync so a raced symlink cannot redirect writes.
  assertNoSymlinkPath(safeDir, label);
  const after = lstatOrNull(safeDir);
  if (!after || after.isSymbolicLink() || !after.isDirectory()) {
    throw new StudioError(409, "symlink-refused", `${label} is not a trusted directory`);
  }
  return realpathSync.native(safeDir);
}

export function validatePackFileName(fileName: unknown): string {
  if (
    typeof fileName !== "string" ||
    !PACK_FILE_NAME.test(fileName) ||
    fileName.includes("..") ||
    WINDOWS_RESERVED_NAME.test(fileName)
  ) {
    throw new StudioError(400, "invalid-pack-name", "pack fileName must match [a-z0-9][a-z0-9._-]{0,63}.json without '..' or reserved device names");
  }
  return fileName;
}

function slugifyId(raw: string, fallback: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[^a-z0-9]+/u, "")
    .replace(/-+$/u, "")
    .slice(0, 80);
  return slug !== "" ? slug : fallback;
}

function topCounts(map: Map<string, number>, limit: number): Array<{ value: string; count: number }> {
  return [...map.entries()]
    .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : compareCodeUnits(a[0], b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

/** Linear O(N) CSS block-comment stripper (avoids regex backtracking). */
function stripCssComments(css: string): string {
  let out = "";
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("/*", i);
    if (open === -1) {
      out += css.slice(i);
      break;
    }
    out += css.slice(i, open) + " ";
    const close = css.indexOf("*/", open + 2);
    if (close === -1) break;
    i = close + 2;
  }
  return out;
}

/**
 * Strictly O(N) scanner that splits `<style>` block bodies out of HTML and strips both `<script>`
 * and `<style>` blocks without lazy regex backtracking on repeated unclosed tags.
 */
function scanHtmlTagsLinear(html: string): { styleBlocks: string[]; strippedHtml: string } {
  // ASCII-only lowercase keeps 1-to-1 UTF-16 code-unit indices (e.g. U+0130 stays length 1).
  const lower = html.replace(/[A-Z]/gu, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
  const len = html.length;
  const styleBlocks: string[] = [];
  const kept: string[] = [];
  let cursor = 0;

  while (cursor < len) {
    const lt = lower.indexOf("<", cursor);
    if (lt === -1) {
      kept.push(html.slice(cursor));
      break;
    }
    const isStyle =
      lower.startsWith("<style", lt) &&
      (lt + 6 === len || /[\s/>]/u.test(lower[lt + 6]));
    const isScript =
      lower.startsWith("<script", lt) &&
      (lt + 7 === len || /[\s/>]/u.test(lower[lt + 7]));

    if (!isStyle && !isScript) {
      kept.push(html.slice(cursor, lt + 1));
      cursor = lt + 1;
      continue;
    }

    kept.push(html.slice(cursor, lt));
    const openEnd = lower.indexOf(">", lt + (isStyle ? 6 : 7));
    if (openEnd === -1) {
      // Unclosed opening tag: discard remainder cleanly in O(1).
      break;
    }
    const closeNeedle = isStyle ? "</style" : "</script";
    const closeStart = lower.indexOf(closeNeedle, openEnd + 1);
    if (closeStart === -1) {
      if (isStyle) styleBlocks.push(html.slice(openEnd + 1));
      break;
    }
    if (isStyle) styleBlocks.push(html.slice(openEnd + 1, closeStart));
    const closeEnd = lower.indexOf(">", closeStart + closeNeedle.length);
    if (closeEnd === -1) break;
    cursor = closeEnd + 1;
  }

  return { styleBlocks, strippedHtml: kept.join("") };
}

/**
 * Extract structured design patterns (color palette, typography, spacing, layout primitives,
 * landmarks, and CSS custom property names) locally and offline. Never copies raw HTML/CSS markup
 * for verbatim reuse — strictly `observed-inspiration-only`.
 */
export function extractPatternsFromSource({ html = "", css = "" }: { html?: string; css?: string }) {
  if (typeof html !== "string" || typeof css !== "string") {
    throw new StudioError(400, "invalid-input", "html and css must be strings");
  }
  if (Buffer.byteLength(html, "utf8") > RESEARCH_LIMITS.maxInputBytes || Buffer.byteLength(css, "utf8") > RESEARCH_LIMITS.maxInputBytes) {
    throw new StudioError(413, "input-too-large", `html and css inputs may each be at most ${RESEARCH_LIMITS.maxInputBytes} bytes`);
  }

  const { styleBlocks, strippedHtml } = scanHtmlTagsLinear(html);
  const allStyleParts: string[] = [css, ...styleBlocks];
  for (const match of strippedHtml.matchAll(/\bstyle\s*=\s*(?:"([^"]{1,4000})"|'([^']{1,4000})')/giu)) {
    allStyleParts.push(`:scope { ${match[1] ?? match[2] ?? ""} }`);
  }
  const combinedCss = stripCssComments(allStyleParts.join("\n"));

  const colorCounts = new Map<string, number>();
  const bump = (map: Map<string, number>, raw: string) => {
    const clean = raw.trim().replace(/\s+/gu, " ");
    if (clean !== "") map.set(clean, (map.get(clean) ?? 0) + 1);
  };

  for (const m of combinedCss.matchAll(/#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/gu)) {
    bump(colorCounts, m[0].toLowerCase());
  }
  for (const m of combinedCss.matchAll(/\b(?:rgba?|hsla?|oklch|oklab)\(\s*[^()]{1,80}\)/giu)) {
    bump(colorCounts, m[0].toLowerCase());
  }

  const fontFamilies = new Map<string, number>();
  const fontSizes = new Map<string, number>();
  const fontWeights = new Map<string, number>();
  const lineHeights = new Map<string, number>();
  const spacing = new Map<string, number>();
  const radii = new Map<string, number>();

  for (const m of combinedCss.matchAll(/\b(font-family|font-size|font-weight|line-height|padding|margin|gap|row-gap|column-gap|border-radius)\s*:\s*([^;{}\n]{1,160})/giu)) {
    const prop = m[1].toLowerCase();
    const val = m[2].trim();
    if (prop === "font-family") bump(fontFamilies, val);
    else if (prop === "font-size") bump(fontSizes, val);
    else if (prop === "font-weight") bump(fontWeights, val);
    else if (prop === "line-height") bump(lineHeights, val);
    else if (prop === "border-radius") bump(radii, val);
    else bump(spacing, val);
  }

  const customProps = extractCssCustomProperties(combinedCss);
  const customPropNames = [...new Set(customProps.map((p) => p.name))].sort(compareCodeUnits).slice(0, 64);

  const landmarks: Record<string, number> = Object.create(null);
  const headings: Record<string, number> = Object.create(null);
  const interactive: Record<string, number> = Object.create(null);

  for (const m of strippedHtml.matchAll(/<([a-z][a-z0-9-]*)\b/giu)) {
    const tag = m[1].toLowerCase();
    if (["header", "nav", "main", "section", "article", "aside", "footer"].includes(tag)) {
      landmarks[tag] = (landmarks[tag] ?? 0) + 1;
    } else if (/^h[1-6]$/u.test(tag)) {
      headings[tag] = (headings[tag] ?? 0) + 1;
    } else if (["button", "a", "input", "form", "select", "textarea"].includes(tag)) {
      interactive[tag] = (interactive[tag] ?? 0) + 1;
    }
  }

  const sortRecord = (rec: Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(rec).sort(compareCodeUnits)) out[k] = rec[k];
    return out;
  };

  return {
    rightsPolicy: "observed-inspiration-only",
    colors: topCounts(colorCounts, 32),
    typography: {
      fontFamilies: topCounts(fontFamilies, 12),
      fontSizes: topCounts(fontSizes, 16),
      fontWeights: topCounts(fontWeights, 10),
      lineHeights: topCounts(lineHeights, 10),
    },
    spacing: {
      values: topCounts(spacing, 24),
      radii: topCounts(radii, 12),
    },
    customProperties: {
      count: customProps.length,
      names: customPropNames,
    },
    layout: {
      usesGrid: /\bdisplay\s*:\s*(?:inline-)?grid\b/iu.test(combinedCss),
      usesFlex: /\bdisplay\s*:\s*(?:inline-)?flex\b/iu.test(combinedCss),
      mediaQueries: (combinedCss.match(/@media\b/giu) ?? []).length,
      containerQueries: (combinedCss.match(/@container\b/giu) ?? []).length,
      landmarks: sortRecord(landmarks),
      headings: sortRecord(headings),
      interactive: sortRecord(interactive),
    },
  };
}

export interface LocalReferenceEntryInput {
  id?: string;
  kind?: "screen" | "flow" | "pattern" | "asset" | "token" | "component";
  title: string;
  tags?: string[];
  sourceUri?: string;
  confidence?: "observed" | "documented" | "inferred" | "unknown";
  patterns?: Record<string, unknown>;
  rights?: { status: "verified" | "restricted" | "unknown"; license: string | null; redistributable: boolean };
}

/**
 * Create a schema-v1 normalized portable Ninerr reference pack with strict rights defaults
 * (`restricted`, `redistributable: false` / `observed-inspiration-only`).
 */
export function createLocalReferencePack({
  packId,
  entries,
  now = () => new Date().toISOString(),
}: {
  packId: string;
  entries: LocalReferenceEntryInput[];
  now?: () => string;
}) {
  if (typeof packId !== "string" || packId.trim() === "") {
    throw new StudioError(400, "invalid-pack-id", "packId must be a non-empty string");
  }
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > RESEARCH_LIMITS.maxEntries) {
    throw new StudioError(400, "invalid-entries", `entries must contain 1 to ${RESEARCH_LIMITS.maxEntries} reference items`);
  }
  const createdAt = now();
  const normPackId = packId.startsWith("urn:ninerr:pack:")
    ? packId
    : `urn:ninerr:pack:${slugifyId(packId, "local-pack")}`;

  const sources: any[] = [];
  const objects: any[] = [];
  const assets: any[] = [];
  const seenSources = new Set<string>();
  const seenAssets = new Set<string>();

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (!entry || typeof entry !== "object" || typeof entry.title !== "string" || entry.title.trim() === "") {
      throw new StudioError(400, "invalid-entries", `entries[${i}] requires a non-empty title`);
    }
    const kind = entry.kind ?? "pattern";
    if (!OBJECT_KINDS.has(kind)) {
      throw new StudioError(400, "invalid-entries", `entries[${i}].kind must be one of ${[...OBJECT_KINDS].join(", ")}`);
    }
    const cleanTitle = withoutUnsafeText(entry.title).trim().slice(0, 200);
    if (cleanTitle === "") {
      throw new StudioError(400, "invalid-entries", `entries[${i}].title contains no displayable characters`);
    }
    const rawTags = Array.isArray(entry.tags) ? entry.tags : [];
    const cleanTags = [...new Set(
      rawTags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.toLowerCase().trim().replace(/[^a-z0-9._/-]+/gu, "-").replace(/^[^a-z0-9]+/u, "").slice(0, 32))
        .filter((t) => SAFE_TAG.test(t)),
    )].sort(compareCodeUnits).slice(0, 20);

    // Default strictly to observed-inspiration-only (non-redistributable).
    const entryRights = entry.rights ?? { status: "restricted" as const, license: null, redistributable: false };
    const sourceSlug = slugifyId(entry.id ?? `${cleanTitle}-${i + 1}`, `ref-${i + 1}`);
    const sourceId = `urn:ninerr:source:${sourceSlug}`;
    const sourceUri = typeof entry.sourceUri === "string" && entry.sourceUri.trim() !== ""
      ? entry.sourceUri.trim()
      : sourceId;

    if (!seenSources.has(sourceId)) {
      seenSources.add(sourceId);
      sources.push({
        id: sourceId,
        uri: sourceUri,
        observedAt: createdAt,
        rights: entryRights,
      });
    }

    const payloadJson = JSON.stringify({
      title: cleanTitle,
      kind,
      tags: cleanTags,
      patterns: entry.patterns ?? null,
    });
    const payloadBuf = Buffer.from(payloadJson, "utf8");
    const assetSha256 = createHash("sha256").update(payloadBuf).digest("hex");
    if (!seenAssets.has(assetSha256)) {
      seenAssets.add(assetSha256);
      assets.push({
        sha256: assetSha256,
        byteLength: payloadBuf.byteLength,
        mediaType: "application/json",
      });
    }

    const objectId = entry.id && entry.id.startsWith("urn:ninerr:object:")
      ? entry.id
      : `urn:ninerr:object:${slugifyId(entry.id ?? `${cleanTitle}-${i + 1}`, `obj-${i + 1}`)}`;

    objects.push({
      id: objectId,
      kind,
      title: cleanTitle,
      tags: cleanTags,
      sourceId,
      assetSha256,
      confidence: entry.confidence ?? "observed",
      visibility: "public",
      rights: entryRights,
    });
  }

  let pack;
  try {
    pack = normalizeReferencePack({
      schemaVersion: 1,
      packId: normPackId,
      ownerScope: null,
      createdAt,
      sources,
      objects,
      assets,
    });
  } catch (error) {
    throw new StudioError(422, "invalid-reference-pack", error instanceof Error ? error.message : String(error));
  }
  const digest = referencePackDigest(pack);
  return { pack, digest };
}

/** Write a normalized reference pack safely (post-mkdir symlink-checked directory, owner-only `writeTrustedFile`). */
export function writeLocalReferencePack({
  directory,
  fileName,
  pack,
  replace = false,
}: {
  directory: string;
  fileName: string;
  pack: unknown;
  replace?: boolean;
}) {
  const validName = validatePackFileName(fileName);
  const safeDir = ensureRealDirectory(directory, "references directory");
  const target = join(safeDir, validName);
  const existing = lstatOrNull(target);
  if (existing !== null) {
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new StudioError(409, "symlink-refused", `refusing to overwrite symlink or non-regular file ${validName}`);
    }
    if (!replace) {
      throw new StudioError(409, "pack-exists", `reference pack ${validName} already exists (pass replace: true to overwrite)`);
    }
  }
  const caseCollision = readdirSync(safeDir).some((entry) => entry.toLowerCase() === validName.toLowerCase());
  if (caseCollision && !replace) {
    throw new StudioError(409, "pack-exists", `reference pack ${validName} already exists (pass replace: true to overwrite)`);
  }
  const normalized = normalizeReferencePack(pack);
  const digest = referencePackDigest(normalized);
  writeTrustedFile(target, `${JSON.stringify(normalized, null, 2)}\n`);
  return { path: target, fileName: validName, packId: normalized.packId, packDigest: digest, objects: normalized.objects.length };
}

/** Read-only listing of `.json` reference packs in `directory` (never creates directories). */
export function listLocalReferencePacks(directory: string): string[] {
  const safeDir = assertNoSymlinkPath(directory, "references directory");
  const stat = lstatOrNull(safeDir);
  if (stat === null) return [];
  if (!stat.isDirectory()) throw new StudioError(400, "invalid-directory", "references path is not a directory");
  return readdirSync(safeDir, { withFileTypes: true })
    .filter((entry) => !entry.isSymbolicLink() && entry.isFile() && PACK_FILE_NAME.test(entry.name) && !WINDOWS_RESERVED_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareCodeUnits)
    .slice(0, RESEARCH_LIMITS.maxPacksListed);
}

/**
 * Check whether an IPv4/IPv6 address belongs to loopback, private, link-local, metadata,
 * transition/NAT64/6to4/Teredo/SIIT, or non-global ranges. Delegates to `@ninerr/network-policy`
 * so every network decision in Ninerr shares one authoritative classifier.
 */
export function isPrivateOrNonGlobalIp(address: string): boolean {
  if (typeof address !== "string" || address.trim() === "" || address.includes("%")) return true;
  return classifyAddress(address) !== "public";
}

/**
 * Strictly human-invoked CLI-only URL design-metric capture.
 * Refuses execution unless `allowNetwork === true`, enforces HTTPS + public-IP SSRF checks
 * via `@ninerr/network-policy` + pinned TLS SNI + total wall-clock timeout + no redirects +
 * HTML/CSS Content-Type allowlist + 512 KiB cap, extracts ONLY metric patterns (discarding raw
 * HTML/CSS), and emits an `observed-inspiration-only` (`restricted`) local reference pack.
 */
export async function captureUrlReferenceMetrics({
  url,
  allowNetwork = false,
  title,
  tags = ["captured", "web"],
  now = () => new Date().toISOString(),
}: {
  url: string;
  allowNetwork?: boolean;
  title?: string;
  tags?: string[];
  now?: () => string;
}) {
  if (allowNetwork !== true) {
    throw new StudioError(403, "network-disabled", "URL capture is disabled by default (Ninerr is zero-egress). Pass --allow-network explicitly to fetch public design metrics.");
  }
  if (typeof url !== "string" || url.trim() === "" || url.length > 2048) {
    throw new StudioError(400, "invalid-url", "url must be a valid HTTPS URL");
  }
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new StudioError(400, "invalid-url", "url must be a valid HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || (parsed.port !== "" && parsed.port !== "443")) {
    throw new StudioError(400, "invalid-url", "only standard-port https:// URLs without credentials are allowed");
  }
  const rawHost = parsed.hostname.toLowerCase();
  if (rawHost.endsWith(".") || rawHost.startsWith("[") || rawHost.endsWith("]")) {
    throw new StudioError(403, "ssrf-refused", `refusing trailing-dot or bracketed IP host ${JSON.stringify(rawHost)}`);
  }
  const host = rawHost.replace(/\.+$/u, "");
  const bareHost = host.replace(/^\[|\]$/gu, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    isIP(bareHost) !== 0
  ) {
    throw new StudioError(403, "ssrf-refused", `refusing to fetch local, private, or literal-IP host ${JSON.stringify(host)}`);
  }

  let resolved;
  try {
    resolved = await dnsLookup(host, { all: true, verbatim: true });
  } catch {
    throw new StudioError(502, "dns-failed", `could not resolve host ${host}`);
  }
  if (!Array.isArray(resolved) || resolved.length === 0 || resolved.some((r) => isPrivateOrNonGlobalIp(r.address))) {
    throw new StudioError(403, "ssrf-refused", `refusing to fetch host ${host} resolving to a non-global IP address`);
  }

  const pinned = resolved[0];
  const canonicalUri = `${parsed.origin}${parsed.pathname}`;
  const { rawText, contentType } = await new Promise<{ rawText: string; contentType: string }>((resolveReq, rejectReq) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      fn();
    };
    const req = httpsRequest(
      {
        host: pinned.address,
        port: 443,
        family: pinned.family,
        agent: false,
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        servername: host,
        rejectUnauthorized: true,
        timeout: RESEARCH_LIMITS.captureTimeoutMs,
        headers: {
          Host: host,
          Accept: "text/html, text/css;q=0.5",
          "Accept-Encoding": "identity",
          "User-Agent": "Ninerr-Research/0.1 (local metric capture)",
          Connection: "close",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          req.destroy();
          finish(() => rejectReq(new StudioError(403, "redirect-refused", `refusing HTTP ${status} redirect during URL capture`)));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          req.destroy();
          finish(() => rejectReq(new StudioError(502, "fetch-failed", `remote host returned HTTP ${status}`)));
          return;
        }
        const mime = String(res.headers["content-type"] ?? "");
        if (!ALLOWED_CAPTURE_MIME.test(mime)) {
          res.resume();
          req.destroy();
          finish(() => rejectReq(new StudioError(415, "unsupported-media-type", `refusing non-HTML/CSS content-type ${JSON.stringify(mime.slice(0, 60))}`)));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > RESEARCH_LIMITS.maxCaptureBytes) {
            res.destroy();
            req.destroy();
            finish(() => rejectReq(new StudioError(413, "capture-too-large", `remote response exceeded ${RESEARCH_LIMITS.maxCaptureBytes} bytes`)));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          finish(() => resolveReq({
            rawText: Buffer.concat(chunks).toString("utf8"),
            contentType: mime,
          }));
        });
        res.on("error", (err) => finish(() => rejectReq(new StudioError(502, "fetch-failed", err.message))));
      },
    );
    // Total wall-clock deadline prevents slow-drip / Slowloris stalls.
    const deadline = setTimeout(() => {
      req.destroy();
      finish(() => rejectReq(new StudioError(504, "capture-timeout", `capture exceeded ${RESEARCH_LIMITS.captureTimeoutMs}ms total deadline`)));
    }, RESEARCH_LIMITS.captureTimeoutMs);
    deadline.unref?.();

    req.on("timeout", () => {
      req.destroy();
      finish(() => rejectReq(new StudioError(504, "capture-timeout", `capture socket timed out after ${RESEARCH_LIMITS.captureTimeoutMs}ms`)));
    });
    req.on("error", (err) => {
      finish(() => rejectReq(err instanceof StudioError ? err : new StudioError(502, "fetch-failed", err.message)));
    });
    req.end();
  });

  const isCss = contentType.toLowerCase().startsWith("text/css");
  const patterns = extractPatternsFromSource(isCss ? { css: rawText } : { html: rawText });

  const { pack, digest } = createLocalReferencePack({
    packId: `capture-${host}`,
    now,
    entries: [
      {
        kind: "pattern",
        title: typeof title === "string" && title.trim() !== "" ? title.trim() : `Observed metrics from ${host}`,
        tags,
        sourceUri: canonicalUri,
        confidence: "observed",
        patterns,
        rights: { status: "restricted", license: null, redistributable: false },
      },
    ],
  });

  return { pack, digest, patterns, sourceUri: canonicalUri };
}
