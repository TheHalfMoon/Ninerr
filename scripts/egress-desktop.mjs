#!/usr/bin/env node
// R04: whole-process egress proof for the packaged app (Linux, for now):
//
//   node scripts/egress-desktop.mjs <archive made by scripts/package-desktop.mjs>
//
// The packaged app runs under strace, with no proxy, so a connection it tried would really leave
// (scripts/desktop/egress.mjs reads the trace). It covers the main process, renderers, utility
// processes and any child. Negative controls show the trap can fail: a traced child that reaches
// for a reserved address must be seen, Chromium's own send must be seen when the page makes a STUN
// request there, and requests from the page to a font, update and provider host must be refused. The result is printed as one JSON line, and the exit code is 0 only if
// every check held. A clean run is evidence for this run on this system, not for macOS or Windows,
// and not for what the app might do in code this session never reached.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TRACED_CALLS, forbiddenAttempts, networkAttempts, routeQueries } from "./desktop/egress.mjs";
import { preparePackage, sleep, waitForRevision } from "./desktop/drive.mjs";
import { droppedPackets, forbiddenOutbound, lostEvents, macPackets, unattributedOutbound, windowsEvents } from "./desktop/egress-capture.mjs";

const archive = process.argv[2] ? resolve(process.argv[2]) : null;
if (archive === null || process.argv.length !== 3 || !existsSync(archive)) {
  process.stderr.write("usage: node scripts/egress-desktop.mjs <archive made by scripts/package-desktop.mjs>\n");
  process.exit(2);
}
if (!["linux", "darwin", "win32"].includes(process.platform)) {
  process.stderr.write(`no egress capture for ${process.platform}\n`);
  process.exit(2);
}
// io_uring's submissions cannot be read in a trace, so it is off: libuv then makes ordinary calls.
// A run in which anything still sets one up fails. The app may run differently with it on.
process.env.UV_USE_IO_URING = "0";
const TRACED = ["-f", "-qq", "-yy", "-s", "8", "-e", `trace=${TRACED_CALLS}`, "-e", "signal=none", "-ff"];
const RESERVED = "192.0.2.1"; // TEST-NET-1, RFC 5737: no such host, and nothing is ever answered from it.
const CHROMIUM_CONTROL_PORT = 8931;
const IDLE_MS = 20_000;
const REFUSED = ["http://192.0.2.1/", "https://fonts.googleapis.com/css2?family=Inter", "https://update.electronjs.org/", "https://api.openai.com/v1/models", "https://example.com/"];

/**
 * WebRTC from the page to the reserved address, which no request rule governs: STUN over UDP, TURN
 * over TCP, and a peer's TCP candidate, so both UDP and TCP are tried (#395).
 */
const stunRequest = (page) => page.evaluate(async ([address, port]) => {
  const peer = new RTCPeerConnection({ iceServers: [{ urls: `stun:${address}:${port}` }, { urls: `turn:${address}:${port}?transport=tcp`, username: "probe", credential: "probe" }] });
  peer.createDataChannel("control");
  await peer.setLocalDescription(await peer.createOffer());
  const other = new RTCPeerConnection();
  other.createDataChannel("control");
  await other.setRemoteDescription(peer.localDescription);
  await other.setLocalDescription(await other.createAnswer());
  await peer.setRemoteDescription(other.localDescription);
  await peer.addIceCandidate({ candidate: `candidate:1 1 tcp 2122260223 ${address} ${port} typ host tcptype passive`, sdpMid: "0", sdpMLineIndex: 0 }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 4000));
  other.close();
  peer.close();
}, [RESERVED, CHROMIUM_CONTROL_PORT]);
// The control over Chromium itself: the app started with its proxy at the reserved address and
// loopback sent through it too, so the editor's first page load is Chromium's own connection off
// this computer. Electron documents both switches. (WebRTC cannot serve: the app's policy holds
// even against Chromium's --force-webrtc-ip-handling-policy, as the runs showed.)
const PROXIED = [`--proxy-server=http://${RESERVED}:${CHROMIUM_CONTROL_PORT}`, "--proxy-bypass-list=<-loopback>"];
const CONTROL_MS = 12_000;

/** Run the proxied control, and give back the processes it had while it ran. */
async function proxiedControl(run) {
  const child = run.spawnRaw(PROXIED);
  const seen = new Set([child.pid]);
  for (let at = 0; at < CONTROL_MS; at += 3000) {
    await sleep(3000);
    for (const pid of descendantsOf(child.pid)) seen.add(pid);
  }
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), sleep(10_000)]);
  return seen;
}

/** The processes below `root` now, on macOS and Windows; on Linux the trace follows them itself. */
function descendantsOf(root) {
  let pairs = [];
  try {
    if (process.platform === "win32") {
      const listed = JSON.parse(execFileSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress"], { encoding: "utf8" }));
      pairs = listed.map(({ ProcessId, ParentProcessId }) => [ProcessId, ParentProcessId]);
    } else if (process.platform === "darwin") {
      pairs = execFileSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).trim().split("\n").map((line) => line.trim().split(/\s+/u).map(Number));
    }
  } catch {
    return [];
  }
  const found = [];
  let frontier = [root];
  while (frontier.length > 0) {
    const next = pairs.filter(([, parent]) => frontier.includes(parent)).map(([pid]) => pid).filter((pid) => !found.includes(pid));
    found.push(...next);
    frontier = next;
  }
  return found;
}

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

async function traced() {
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

    let appProcesses = [];
    // The person's session and the Chromium control are traced apart: WebRTC sends more than the
    // control asks for, and none of it may be excused in the session's own trace.
    let tracing = "app";
    const run = await preparePackage(archive, {
      proxy: false,
      wrap: (executable, args) => ["strace", [...TRACED, "-o", join(traces, tracing), executable, ...args]],
    });
    try {
      const { launch } = run;
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

      // The processes the app really has, from Chromium itself, to hold the trace to below.
      const cdp = await ninerr.browser.newBrowserCDPSession();
      const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
      appProcesses = processInfo.map(({ id, type }) => ({ id, type }));

      // The app's own negative control: the page reaches for font, update and provider hosts.
      for (const url of REFUSED) {
        const answer = await page.evaluate((target) => fetch(target).then((response) => `answered ${response.status}`, (failure) => `refused: ${failure.message}`), url);
        check(`the page is refused ${new URL(url).hostname}`, answer.startsWith("refused"), answer);
      }
      // Left idle a while, for anything that waits before it reaches out.
      // The app's own STUN request (#395): hardened, it must send nothing, as the check below holds.
      await stunRequest(page);
      await sleep(IDLE_MS);

      const quit = await ninerr.quit();
      check("closing Ninerr quits it cleanly", quit === 0, { exit: quit, output: ninerr.output().slice(-300) });

      // The control over Chromium itself, in a run of its own with WebRTC as Chromium has it: a STUN
      // request, which no request rule governs, so Chromium really sends it.
      tracing = "stun";
      await proxiedControl(run);
    } finally {
      await run.close();
    }

    const attempts = networkAttempts(traceOf(traces, "app"));
    // strace writes one file per thread, under its id, and a process's first thread has its pid.
    const threads = new Set(readdirSync(traces).filter((name) => name.startsWith("app.")).map((name) => Number(name.slice(4))));
    const types = new Set(appProcesses.map(({ type }) => type));
    check("Chromium reports a browser, a renderer and more", types.has("browser") && types.has("renderer") && appProcesses.length >= 3, appProcesses);
    const untraced = appProcesses.filter(({ id }) => !threads.has(id));
    check("every process Chromium reports was traced", untraced.length === 0, { untraced, threads: threads.size });
    check("the trace saw the app's loopback traffic to its host", attempts.some(({ address }) => address === "127.0.0.1"), attempts.slice(0, 5));
    const forbidden = forbiddenAttempts(attempts);
    const appTrace = traceOf(traces, "app");
    const rings = appTrace.split("\n").filter((line) => line.includes("io_uring_setup")).map((line) => line.slice(0, 160));
    check("nothing in any process reached off this computer", forbidden.length === 0, { forbidden: forbidden.slice(0, 20), rings });
    // After the session's own check, so a failing control cannot hide the session's result.
    const controlSends = forbiddenAttempts(networkAttempts(traceOf(traces, "stun")));
    check("the trap saw Chromium's own connection off this computer, in the control", controlSends.some(({ address, port }) => address === RESERVED && port === CHROMIUM_CONTROL_PORT), controlSends.slice(0, 20));
    // Named in the result, so a new one is seen: these leave no packet.
    const queries = routeQueries(attempts).map(({ address, port }) => `${address} port ${port}`);
    process.stdout.write(`${JSON.stringify({ ok: true, processes: appProcesses, threads: threads.size, attempts: attempts.length, udpRouteQueries: [...new Set(queries)], ringSetups: rings, checks })}\n`);
  } finally {
    rmSync(traces, { recursive: true, force: true, maxRetries: 5 });
  }
}

/**
 * Start the system's capture: on macOS, tcpdump on pktap, which charges each packet to a process;
 * on Windows, the kernel's network events. Returns stop(), which gives the outbound events.
 */
async function startCapture(folder) {
  if (process.platform === "darwin") {
    const lines = [];
    const capture = spawn("sudo", ["tcpdump", "-i", "pktap", "-B", "65536", "-k", "NP", "-nn", "-l"], { stdio: ["ignore", "pipe", "pipe"] });
    let said = "";
    capture.stdout.on("data", (chunk) => lines.push(String(chunk)));
    capture.stderr.on("data", (chunk) => { said += String(chunk); });
    for (let tries = 0; tries < 50 && !said.includes("listening on"); tries += 1) await sleep(200);
    check("the capture starts", said.includes("listening on"), said.slice(-300));
    return async () => {
      spawnSync("sudo", ["pkill", "-INT", "-x", "tcpdump"]);
      await Promise.race([new Promise((resolve) => capture.once("exit", resolve)), sleep(10_000)]);
      // A packet the kernel dropped was not seen, so a clean result would not cover it.
      check("the capture dropped no packet", droppedPackets(said) === 0, said.slice(-300));
      const text = lines.join("");
      // This computer's own addresses, so a packet to them is read as inbound.
      const local = new Set(Object.values(networkInterfaces()).flat().map(({ address }) => address.replace(/%.*$/u, "")));
      return { events: macPackets(text, local), sample: text.split("\n").slice(0, 12).map((line) => line.slice(0, 200)) };
    };
  }
  const etl = join(folder, "net.etl");
  const xml = join(folder, "net.xml");
  spawnSync("logman", ["stop", "NinerrNet", "-ets"]);
  execFileSync("logman", ["start", "NinerrNet", "-p", "Microsoft-Windows-Kernel-Network", "0xFFFFFFFFFFFFFFFF", "0xff", "-o", etl, "-bs", "1024", "-nb", "64", "512", "-ets"], { stdio: "pipe" });
  check("the capture starts", true);
  return async () => {
    execFileSync("logman", ["stop", "NinerrNet", "-ets"], { stdio: "pipe" });
    execFileSync("tracerpt", [etl, "-o", xml, "-of", "XML", "-y"], { stdio: "pipe" });
    const text = readFileSync(xml, "utf16le").replace(/^\uFEFF/u, "");
    const plain = text.includes("<Event") ? text : readFileSync(xml, "utf8");
    // An event the trace lost was not seen, so a clean result would not cover it.
    check("the capture lost no event", lostEvents(plain) === 0, { lost: lostEvents(plain), head: plain.slice(0, 1200) });
    return { events: windowsEvents(plain), sample: plain.slice(0, 1500) };
  };
}

/** The same session and controls, under a capture tagged by process (macOS and Windows). */
async function captured() {
  const folder = realpathSync(mkdtempSync(join(tmpdir(), "ninerr-egress-capture-")));
  try {
    const stop = await startCapture(folder);
    // The control of the capture itself: a child that reaches off this computer by TCP and UDP.
    const script = join(folder, "control.cjs");
    writeFileSync(script, `
      const net = require("node:net"), dgram = require("node:dgram");
      const sent = dgram.createSocket("udp4");
      sent.send("x", 9, ${JSON.stringify(RESERVED)}, () => {
        sent.close();
        net.connect({ port: 12, host: ${JSON.stringify(RESERVED)}, timeout: 1500 }).on("error", () => process.exit(0)).on("timeout", () => process.exit(0));
      });`);
    const child = spawn(process.execPath, [script], { stdio: "ignore" });
    await new Promise((resolve) => child.once("exit", resolve));
    const controlPid = child.pid;

    const sessionPids = new Set();
    const stunPids = new Set();
    const run = await preparePackage(archive, { proxy: false });
    const processesOf = async (launched, into) => {
      into.add(launched.pid);
      const cdp = await launched.browser.newBrowserCDPSession();
      const { processInfo } = await cdp.send("SystemInfo.getProcessInfo");
      for (const { id } of processInfo) into.add(id);
      return processInfo.map(({ id, type }) => ({ id, type }));
    };
    let appProcesses = [];
    try {
      const ninerr = await run.launch();
      const { page } = ninerr;
      check("it runs as a packaged app", ninerr.packaged(), ninerr.output().slice(-300));
      await page.locator("#new-project-name").fill("egress");
      await page.locator("#dialog[open] button.primary", { hasText: "Create project" }).click();
      await waitForRevision(page, 0);
      await page.locator("#action-insert-box").click();
      await waitForRevision(page, 1);
      await page.locator("#inspect-name").fill("Captured");
      await page.locator("#inspect-name").press("Tab");
      await waitForRevision(page, 2);
      await page.locator("#action-save").click();
      await page.locator("#action-research").click();
      await page.waitForFunction(() => document.getElementById("research-status")?.textContent !== "");
      await page.keyboard.press("Escape");
      appProcesses = await processesOf(ninerr, sessionPids);
      for (const url of REFUSED) {
        const answer = await page.evaluate((target) => fetch(target).then((response) => `answered ${response.status}`, (failure) => `refused: ${failure.message}`), url);
        check(`the page is refused ${new URL(url).hostname}`, answer.startsWith("refused"), answer);
      }
      // The app's own STUN request (#395): hardened, it must send nothing, as the check below holds.
      await stunRequest(page);
      await sleep(IDLE_MS);
      await processesOf(ninerr, sessionPids);
      const quit = await ninerr.quit();
      check("closing Ninerr quits it cleanly", quit === 0, { exit: quit, output: ninerr.output().slice(-300) });

      // The control over Chromium itself, in a run of its own.
      for (const pid of await proxiedControl(run)) stunPids.add(pid);
    } finally {
      await run.close();
    }
    await sleep(1500);
    const { events, sample } = await stop();
    const control = forbiddenOutbound(events, new Set([controlPid]));
    check("the capture charges a child's TCP off this computer to it", control.some(({ address, port }) => address === RESERVED && port === 12), { control, sample });
    check("the capture charges a child's UDP off this computer to it", control.some(({ address, port }) => address === RESERVED && port === 9), { control, sample });
    const stunSends = forbiddenOutbound(events, stunPids);
    const types = new Set(appProcesses.map(({ type }) => type));
    check("Chromium reports a browser, a renderer and more", types.has("browser") && types.has("renderer") && appProcesses.length >= 3, appProcesses);
    let forbidden;
    if (process.platform === "darwin") {
      // The runner's capture leaves loopback out, so the session's traffic is also held to the
      // app's name, which pktap gives each packet: the control shows that name on Chromium's send.
      // The packaged executable and helpers keep Electron's names (scripts/package-desktop.mjs),
      // as the runner showed: "Electron", and "Electron Helper" with its kinds.
      const named = (name) => typeof name === "string" && /^Electron(?: Helper\b|$)/u.test(name);
      const appSessionPids = new Set([...sessionPids, ...events.filter(({ pid, name }) => named(name) && !stunPids.has(pid)).map(({ pid }) => pid), ...events.filter(({ epid, ename }) => named(ename) && !stunPids.has(epid)).map(({ epid }) => epid)]);
      forbidden = forbiddenOutbound(events, appSessionPids);
    } else {
      // The capture charges the app's own traffic to its processes: if this does not hold, a clean
      // result below would mean nothing.
      check("the capture charged the app's loopback traffic to its processes", events.some(({ pid, address }) => sessionPids.has(pid) && address === "127.0.0.1"), { events: events.length, sample });
      forbidden = forbiddenOutbound(events, sessionPids);
    }
    check("nothing the app's processes sent left this computer", forbidden.length === 0, forbidden.slice(0, 20));
    // After the session's own check, so a failing control cannot hide the session's result.
    const controlSends = stunSends.filter(({ address, port }) => address === RESERVED && port === CHROMIUM_CONTROL_PORT);
    check("the capture saw Chromium's own connection off this computer, in the control", controlSends.length > 0, { stunSends: stunSends.slice(0, 10), stunPids: [...stunPids], sample });
    if (process.platform === "darwin") {
      const named = (name) => typeof name === "string" && /^Electron(?: Helper\b|$)/u.test(name);
      check("the capture names the app on Chromium's own connection, in the control", controlSends.every(({ name }) => named(name)), controlSends.slice(0, 5));
    }
    const unattributed = unattributedOutbound(events);
    process.stdout.write(`${JSON.stringify({ ok: true, processes: appProcesses, events: events.length, unattributed: [...new Set(unattributed.map(({ address, port }) => `${address} port ${port}`))].slice(0, 20), checks })}\n`);
  } finally {
    rmSync(folder, { recursive: true, force: true, maxRetries: 5 });
  }
}

const main = process.platform === "linux" ? traced : captured;

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error), checks })}\n`);
  process.exitCode = 1;
});
