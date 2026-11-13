import { isIP } from "node:net";
import {
  defaultNetworkPolicy,
  evaluateResolved,
  evaluateUrl,
  isForbiddenRemoteAddress,
  isLoopbackAddress,
  type NetworkPolicy,
  type UrlDecision,
} from "@ninerr/network-policy";
import { ImportSecurityError, ImportValidationError } from "./errors.ts";
import type { ImportPolicy } from "./types.ts";
import { assertSafeProvenanceUrl } from "./validation.ts";

// Address classification is owned by @ninerr/network-policy; re-exported for compatibility.
export { isForbiddenRemoteAddress, isLoopbackAddress };

/**
 * The project network policy must also allow the contact. A missing policy is the default
 * offline policy, so a caller that forgets to pass one fails closed.
 */
function networkDecision(url: URL, networkPolicy: NetworkPolicy | undefined): UrlDecision {
  const decision = evaluateUrl(networkPolicy ?? defaultNetworkPolicy(), { capability: "import.fetch", url: url.href });
  if (!decision.allowed) throw new ImportSecurityError(`network policy denied import.fetch: ${decision.reason}`);
  return decision;
}

/**
 * Validate a URL before any contact. Both the import policy (Grain 6 mode and target rules)
 * and the project network policy (`import.fetch` grant) must allow it.
 */
export function validateNavigationUrl(raw: string, policy: ImportPolicy, networkPolicy?: NetworkPolicy): URL {
  if (typeof raw !== "string" || raw.trim() === "" || raw.length > 4096) {
    throw new ImportValidationError("navigation URL must be a bounded non-empty string");
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new ImportValidationError("navigation URL is invalid"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ImportSecurityError("navigation URL must use http or https");
  }
  assertSafeProvenanceUrl(url.href, "navigation URL");
  if (!policy.allowNetwork || policy.mode === "offline") throw new ImportSecurityError("network is disabled by import policy");
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  const literal = hostname.replace(/^\[|\]$/gu, "");
  if (policy.mode === "local-app") {
    if (!policy.allowLoopback) throw new ImportSecurityError("local-app mode requires loopback capability");
    if (hostname !== "localhost" && !hostname.endsWith(".localhost") && !isLoopbackAddress(literal)) {
      throw new ImportSecurityError("local-app mode only permits loopback targets");
    }
  } else if (
    hostname === "localhost"
    || hostname.endsWith(".localhost")
    || (isIP(literal) !== 0 && isForbiddenRemoteAddress(literal))
  ) {
    throw new ImportSecurityError("remote mode rejects local/private/reserved targets");
  }
  networkDecision(url, networkPolicy);
  return url;
}

// A failure reason names no address a name resolved to: it reaches whoever asked for the import
// (an agent, through a tool result), and must not map the network behind it (#94).
const ADDRESS_LITERAL = /\b\d{1,3}(?:\.\d{1,3}){3}\b|(?:[0-9a-f]{0,4}:){2,7}[0-9a-f.]{0,15}/giu;
function withoutAddresses(reason: string): string {
  return reason.replace(ADDRESS_LITERAL, "[address]");
}

/** Validate the addresses actually used to connect against both policies (DNS-rebinding guard). */
export function validateResolvedAddresses(url: URL, addresses: readonly string[], policy: ImportPolicy, networkPolicy?: NetworkPolicy): void {
  if (addresses.length === 0) throw new ImportSecurityError("target resolution returned no addresses");
  for (const address of addresses) {
    if (isIP(address) === 0) throw new ImportSecurityError("resolver returned a non-IP address");
    if (policy.mode === "local-app") {
      if (!isLoopbackAddress(address)) throw new ImportSecurityError("local-app resolution escaped loopback");
    } else if (policy.mode === "remote") {
      if (isForbiddenRemoteAddress(address)) throw new ImportSecurityError("remote target resolved to forbidden address (private, loopback, link-local or reserved)");
    } else {
      throw new ImportSecurityError("offline policy cannot resolve network addresses");
    }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new ImportSecurityError("resolved target protocol is unsupported");
  const resolved = evaluateResolved(networkDecision(url, networkPolicy), [...addresses]);
  if (!resolved.allowed) throw new ImportSecurityError(`network policy denied resolved addresses: ${withoutAddresses(resolved.reason)}`);
}
