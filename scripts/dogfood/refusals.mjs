// #377: the one refusal the dogfooding check accepts. The editor shares its selection 100 ms after
// it changes, for the project it knows, and a project closed from outside the tab can win that
// race. The host is right to refuse, and the editor ignores it, but the browser still logs
// "Failed to load resource". Everything else the page logs is an error.

const SELECTION = "/api/selection";

/** Whether an answer to POST /api/selection is the host's refusal for a project that changed. */
export function isSelectionRefusal(method, path, status, body) {
  if (method !== "POST" || path !== SELECTION || status !== 409) return false;
  try {
    return JSON.parse(body)?.error?.code === "project-changed";
  } catch {
    return false;
  }
}

/**
 * Splits what the page logged ({ text, url }) into errors and those explained by a refusal seen,
 * each refusal explaining one line. A line with no body seen for it stays an error.
 */
export function withoutSelectionRefusals(logged, refusals) {
  let left = refusals;
  const errors = [];
  const accepted = [];
  for (const entry of logged) {
    let path = null;
    try {
      path = new URL(entry.url).pathname;
    } catch {
      // Not a request's line.
    }
    if (left > 0 && path === SELECTION && /^Failed to load resource: .*\b409\b/u.test(entry.text)) {
      left -= 1;
      accepted.push(entry);
    } else errors.push(entry);
  }
  return { errors, accepted };
}
