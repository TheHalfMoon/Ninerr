// Cleanup that runs even when a test times out (#305). A test that waits without end fails
// by its name after its timeout, but node:test then abandons its body: a `finally` in it never
// runs, and what it opened (a browser, a host) holds the run until the job's limit. A hook
// registered with node:test's `after` from inside a test belongs to that test, and runs when
// the test ends however it ends, a timeout included.
import { after } from "node:test";

const BOUND_MS = 30_000;

/**
 * Run `close` after the current test, at most once and within BOUND_MS, and return the
 * same once-only close for the test's own use: closing first in a `finally` and again here
 * is one close. Call it from inside the test that opened the thing.
 */
export function closeAfterTest(close, what) {
  let closing = null;
  const once = () => (closing ??= Promise.resolve().then(close));
  after(() => {
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(() => {
        process.stderr.write(`# ${what} did not close within ${BOUND_MS / 1000} s after its test\n`);
        resolve();
      }, BOUND_MS);
      timer.unref?.();
    });
    // A close that fails is the test's own failure to report, not the hook's.
    return Promise.race([once().catch(() => {}), late]).finally(() => clearTimeout(timer));
  });
  return once;
}

/** startStudioHost, closed after the current test (closeAfterTest). */
export async function startTestHost(options) {
  const { startStudioHost } = await import("../../packages/studio-host/src/index.ts");
  const host = await startStudioHost(options);
  host.close = closeAfterTest(host.close.bind(host), "a studio host");
  return host;
}
