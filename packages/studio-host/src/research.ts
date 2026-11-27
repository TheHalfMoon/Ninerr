// Ninerr Research: offline pattern extraction, rights-aware portable local reference packs,
// and strictly human-invoked CLI-only URL metric capture (NEVER exposed via MCP, zero silent egress).

import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { lstatSync, mkdirSync, readdirSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { join } from "node:path";
import { normalizeReferencePack, referencePackDigest, withoutUnsafeText } from "@ninerr/import-stack";
import { StudioError } from "./errors.ts";
import { assertNoSymlinkPath, extractCssCustomProperties } from "./redesign.ts";
import { writeTrustedFile } from "./trusted-file.ts";

export const RESEARCH_LIMITS = Object.freeze({
  maxInputBytes: 512 * 1024,
  maxEntries: 64,
  maxCaptureBytes: 1024 * 1024,
  captureTimeoutMs: 10_000,
  maxPacksListed: 200,
});

const PACK_FILE_NAME = /^[a-z0-9][a-z0-9._-]{0,63}\.json$/u;
const SAFE_TAG = /^[a-z0-9][a-z0-9._/-]{0,31}$/u;
const OBJECT_KINDS = new Set(["screen", "flow", "pattern", "asset", "token", "component"]);
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

export function validatePackFileName(fileName: unknown): string {
  if (typeof fileName !== "string" || !PACK_FILE_NAME.test(fileName) || fileName.includes("..")) {
    throw new StudioError(400, "invalid-pack-name", "pack fileName must match [a-z0-9][a-z0-9._-]{0,63}.json without '..'");
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

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, " ");
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

  // Pull inline <style> blocks and inline style="..." attributes into CSS analysis without executing scripts.
  const styleBlocks: string[] = [css];
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/giu)) {
    styleBlocks.push(match[1]);
  }
  for (const match of html.matchAll(/\bstyle\s*=\s*(?:"([^"]{1,4000})"|'([^']{1,4000})')/giu)) {
    styleBlocks.push(`:scope { ${match[1] ?? match[2] ?? ""} }`);
  }
  const combinedCss = stripCssComments(styleBlocks.join("\n"));

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
  const htmlWithoutScriptStyle = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, "");

  for (const m of htmlWithoutScriptStyle.matchAll(/<([a-z][a-z0-9-]*)\b/giu)) {
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

/** Write a normalized reference pack safely (symlink-checked directory, owner-only `writeTrustedFile`). */
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
  const safeDir = assertNoSymlinkPath(directory, "references directory");
  const existingDir = lstatOrNull(safeDir);
  if (existingDir !== null && !existingDir.isDirectory()) {
    throw new StudioError(400, "invalid-directory", "references path is not a directory");
  }
  mkdirSync(safeDir, { recursive: true, mode: 0o700 });
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
    .filter((entry) => !entry.isSymbolicLink() && entry.isFile() && PACK_FILE_NAME.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareCodeUnits)
    .slice(0, RESEARCH_LIMITS.maxPacksListed);
}

/** Check whether an IPv4/IPv6 address belongs to loopback, private, link-local, metadata, or non-global ranges. */
export function isPrivateOrNonGlobalIp(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.startsWith("::ffff:")) {
    return isPrivateOrNonGlobalIp(ip.slice("::ffff:".length));
  }
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split(".").map(Number);
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true; // 0.0.0.0/8, 10.0.0.0/8, 127.0.0.0/8
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a === 169 && b === 254) return true; // link-local / cloud metadata 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12
    if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
    if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return true; // IETF / TEST-NET-1
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18.0.0/15
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (v === 6) {
    if (ip === "::" || ip === "::1") return true;
    // ULA fc00::/7, link-local fe80::/10, multicast ff00::/8
    if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb") || ip.startsWith("ff")) {
      return true;
    }
    return false;
  }
  return true;
}

/**
 * Strictly human-invoked CLI-only URL design-metric capture.
 * Refuses execution unless `allowNetwork === true`, enforces HTTPS + public-IP SSRF checks +
 * no redirects + 1 MiB cap, extracts ONLY metric patterns (discarding raw HTML/CSS), and emits
 * an `observed-inspiration-only` (`restricted`, non-redistributable) local reference pack.
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
  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    !host.includes(".") ||
    isIP(host) !== 0
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

  const pinnedIp = resolved[0].address;
  const canonicalUri = `${parsed.origin}${parsed.pathname}`;
  const { rawText, contentType } = await new Promise<{ rawText: string; contentType: string }>((resolveReq, rejectReq) => {
    const req = httpsRequest(
      {
        host: pinnedIp,
        port: 443,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        servername: host,
        rejectUnauthorized: true,
        timeout: RESEARCH_LIMITS.captureTimeoutMs,
        headers: {
          Host: host,
          Accept: "text/html, text/css;q=0.5",
          "User-Agent": "Ninerr-Research/0.1 (local metric capture)",
          Connection: "close",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          rejectReq(new StudioError(403, "redirect-refused", `refusing HTTP ${status} redirect during URL capture`));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          rejectReq(new StudioError(502, "fetch-failed", `remote host returned HTTP ${status}`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.byteLength;
          if (total > RESEARCH_LIMITS.maxCaptureBytes) {
            res.destroy();
            rejectReq(new StudioError(413, "capture-too-large", `remote response exceeded ${RESEARCH_LIMITS.maxCaptureBytes} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          resolveReq({
            rawText: Buffer.concat(chunks).toString("utf8"),
            contentType: String(res.headers["content-type"] ?? ""),
          });
        });
        res.on("error", (err) => rejectReq(new StudioError(502, "fetch-failed", err.message)));
      },
    );
    req.on("timeout", () => {
      req.destroy(new Error(`capture timed out after ${RESEARCH_LIMITS.captureTimeoutMs}ms`));
    });
    req.on("error", (err) => {
      rejectReq(err instanceof StudioError ? err : new StudioError(502, "fetch-failed", err.message));
    });
    req.end();
  });
  const isCss = contentType.toLowerCase().includes("text/css");
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
