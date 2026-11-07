#!/usr/bin/env node
// R04: whole-process egress proof for the packaged app (Linux, for now):
//
//   node scripts/egress-desktop.mjs <archive made by scripts/package-desktop.mjs>
//
// The packaged app runs under strace, with no proxy, so a connection it tried would really leave
// (scripts/desktop/egress.mjs reads the trace). It covers the main process, renderers, utility
// processes and any child. Two negative controls show the trap can fail: a traced child that
// reaches for a reserved address must be seen, and requests from the page to a font, update and
// provider host must be refused. The result is printed as one JSON line, and the exit code is 0
// only if every check held. A clean run is evidence for this run on this system, not for macOS or
// Windows, and not for what the app might do in code this session never reached.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { forbiddenAttempts, networkAttempts, routeQueries } from "./desktop/egress.mjs";
import { preparePackage, waitForRevision } from "./desktop/drive.mjs";

const archive = process.argv[2] ? resolve(process.argv[2]) : null;
if (archive === null || process.argv.length !== 3 || !existsSync(archive)) {
  process.stderr.write("usage: node scripts/egress-desktop.mjs <Ninerr-linux-x64.tar.gz>\n");
  process.exit(2);
}
if (process.platform !== "linux") {
  process.stderr.write("the whole-process trace is on Linux only, for now\n");
  process.exit(2);
}
const TRACED = ["-f", "-qq", "-yy", "-s", "8", "-e", "trace=connect,sendto,sendmsg,sendmmsg,write", "-e", "signal=none", "-ff"];
const RESERVED = "192.0.2.1"; // TEST-NET-1, RFC 5737: no such host, and nothing is ever answered from it.
const REFUSED = ["http://192.0.2.1/", "https://fonts.googleapis.com/css2?family=Inter", "https://update.electronjs.org/", "https://api.openai.com/v1/models", "https://example.com/"];

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  if (!ok) throw new Error(`${name}${detail === undefined ? "" : `: ${JSON.stringify(detail).slice(0, 4000)}`}`);
};

/** Everything strace wrote under `prefix`, one file per process. */
function traceOf(folder, prefix) {
  return readdirSync(folder).filter((name) => name.startsWith(prefix)).map((name) => {
    const pid = name.slice(name.lastIndexOf(".") + 1);
    return readFileSync(join(folder, name), "utf8").split("\n").filter(Boolean).map((line) => `${pid} ${line}`).join("\n");
  }).join("\n");
}

async function main() {
  const traces = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-egress-trace-")));
  try {
    // The negative control of the trap itself: the same trace of a child that reaches off this
    // computer by TCP, by UDP to an address, and by UDP on a connected socket, as well as one UDP
    // route query alone. If these are not told apart, a clean run below would mean nothing.
    const control = `
      const net = require("node:net"), dgram = require("node:dgram");
      const address = ${JSON.stringify(RESERVED)};
      const asked = dgram.createSocket("udp4");
      asked.connect(10, address, () => {
        asked.close();
        const sent = dgram.createSocket("udp4");
        sent.send("x", 9, address, () => {
          sent.close();
          const joined = dgram.createSocket("udp4");
          joined.connect(11, address, () => {
            joined.send("x", () => {
              joined.close();
              net.connect({ port: 12, host: address, timeout: 200 }).on("error", () => process.exit(0)).on("timeout", () => process.exit(0));
            });
          });
        });
      });`;
    const traced = spawnSync("strace", [...TRACED, "-o", join(traces, "control"), process.execPath, "-e", control], { encoding: "utf8", timeout: 30_000 });
    check("strace runs here", traced.error === undefined, traced.error?.message);
    const controlTrace = traceOf(traces, "control");
    const controlAttempts = networkAttempts(controlTrace);
    // The trace's own lines, so a control that fails says what strace printed here.
    const controlLines = controlTrace.split("\n").filter((line) => /UDP|TCP|socket:|sa_family=AF_INET/u.test(line)).map((line) => line.slice(0, 200));
    const seen = forbiddenAttempts(controlAttempts);
    check("the trap forbids a traced child's TCP off this computer", seen.some(({ call, transport, port }) => call === "connect" && transport === "TCP" && port === 12), controlAttempts);
    check("the trap forbids a traced child's UDP to an address", seen.some(({ call, port }) => call !== "connect" && port === 9), controlAttempts);
    check("the trap forbids a send on a connected UDP socket", seen.some(({ call, port }) => call !== "connect" && port === 11), { controlAttempts, controlLines, childSaid: traced.stderr.slice(-300) });
    check("the trap reports a UDP route query, and does not forbid it", routeQueries(controlAttempts).some(({ port }) => port === 10) && !seen.some(({ port }) => port === 10), controlAttempts);

    const run = await preparePackage(archive, {
      proxy: false,
      wrap: (executable, args) => ["strace", [...TRACED, "-o", join(traces, "app"), executable, ...args]],
    });
    try {
      const { launch, egress } = run;
      const ninerr = await launch();
      const { page } = ninerr;
      check("it runs as a packaged app", ninerr.packaged(), ninerr.output().slice(-300));

      // A person's session, on the code paths a person reaches.
      await page.locator("#new-project-name").fill("egress");
      await page.locator("#dialog[open] button.primary", { hasText: "Create project" }).click();
      await waitForRevision(page, 0);
      await page.locator("#action-insert-box").click();
      await waitForRevision(page, 1);
      await page.locator("#inspect-name").fill("Traced");
      await page.locator("#inspect-name").press("Tab");
      await waitForRevision(page, 2);
      await page.locator("#action-save").click();
      await page.locator("#action-research").click();
      await page.waitForFunction(() => document.getElementById("research-status")?.textContent !== "");
      await page.keyboard.press("Escape");

      // The app's own negative control: the page reaches for font, update and provider hosts.
      for (const url of REFUSED) {
        const answer = await page.evaluate((target) => fetch(target).then((response) => `answered ${response.status}`, (failure) => `refused: ${failure.message}`), url);
        check(`the page is refused ${new URL(url).hostname}`, answer.startsWith("refused"), answer);
      }
      const quit = await ninerr.quit();
      check("closing Ninerr quits it cleanly", quit === 0, { exit: quit, output: ninerr.output().slice(-300) });
      check("no proxy was offered, so nothing could have been recorded by one", egress.length === 0, egress);
    } finally {
      await run.close();
    }

    const attempts = networkAttempts(traceOf(traces, "app"));
    const processes = new Set(readdirSync(traces).filter((name) => name.startsWith("app")));
    check("the trace followed several processes", processes.size >= 3, { processes: processes.size });
    check("the trace saw the app's loopback traffic to its host", attempts.some(({ address }) => address === "127.0.0.1"), attempts.slice(0, 5));
    const forbidden = forbiddenAttempts(attempts);
    check("nothing in any process reached off this computer", forbidden.length === 0, forbidden.slice(0, 20));
    // Named in the result, so a new one is seen: these leave no packet.
    const queries = routeQueries(attempts).map(({ address, port }) => `${address} port ${port}`);
    process.stdout.write(`${JSON.stringify({ ok: true, processes: processes.size, attempts: attempts.length, udpRouteQueries: [...new Set(queries)], checks })}\n`);
  } finally {
    rmSync(traces, { recursive: true, force: true, maxRetries: 5 });
  }
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), checks })}\n`);
  process.exitCode = 1;
});
