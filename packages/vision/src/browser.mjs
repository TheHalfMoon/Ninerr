// Zero-dependency local browser controller using Node 22/24 built-in WebSocket CDP.
// Enforces 3-layer cross-platform zero-egress containment:
//   Layer 1: In-process loopback policy proxy refusing every non-allowed host/CONNECT.
//   Layer 2: Chromium/Edge flags (--proxy-server, --proxy-bypass-list=<-loopback>,
//            --host-resolver-rules, --disable-quic, --force-webrtc-ip-handling-policy,
//            and telemetry/background-networking disable flags).
//   Layer 3: CDP Fetch.enable aborting every request outside about:blank, data:, and
//            any explicitly human-authorized local preview origin.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 25_000;

function candidatePathsForPlatform() {
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? "";
    const pf = process.env.PROGRAMFILES ?? "C:\\Program Files";
    const pf86 = process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)";
    return [
      join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      ...(local ? [join(local, "Google", "Chrome", "Application", "chrome.exe"), join(local, "Chromium", "Application", "chrome.exe")] : []),
    ];
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ];
  }
  return [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/microsoft-edge",
    "/snap/bin/chromium",
  ];
}

function isRegularExecutable(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/** Discover an installed local Chromium-based browser executable (Edge, Chrome, or Chromium). */
export function discoverBrowser(overridePath = process.env.NINERR_BROWSER) {
  if (typeof overridePath === "string" && overridePath.trim() !== "") {
    const trimmed = overridePath.trim();
    if (isRegularExecutable(trimmed)) return trimmed;
    throw new Error(`NINERR_BROWSER executable not found at ${trimmed}`);
  }
  for (const candidate of candidatePathsForPlatform()) {
    if (isRegularExecutable(candidate)) return candidate;
  }
  if (process.platform !== "win32") {
    for (const cmd of ["chromium", "chromium-browser", "google-chrome", "microsoft-edge"]) {
      try {
        const resolved = execFileSync("which", [cmd], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
        if (resolved && isRegularExecutable(resolved)) return resolved;
      } catch {
        // continue scanning
      }
    }
  }
  return null;
}

function parseAllowedLoopbackOrigin(rawOrigin) {
  if (rawOrigin === undefined || rawOrigin === null || rawOrigin === "") return null;
  let parsed;
  try {
    parsed = new URL(String(rawOrigin));
  } catch {
    throw new Error(`invalid preview origin: ${String(rawOrigin)}`);
  }
  if (parsed.protocol !== "http:") {
    throw new Error("local preview origin must use http:// on loopback (127.0.0.1 or localhost)");
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error(`preview origin host ${host} is not loopback; Ninerr Vision blocks external origins`);
  }
  const port = parsed.port === "" ? 80 : Number(parsed.port);
  return Object.freeze({ origin: parsed.origin, host: host === "localhost" ? "127.0.0.1" : host, hostname: host, port });
}

/**
 * Layer 1 containment: loopback HTTP/CONNECT proxy that denies ALL traffic except an optional
 * explicitly allowed loopback preview origin, recording every blocked egress attempt.
 */
export async function startStrictContainmentProxy({ allowedOrigin = null } = {}) {
  const allowed = parseAllowedLoopbackOrigin(allowedOrigin);
  const blockedAttempts = [];
  const sockets = new Set();
  let closed = false;

  const track = (socket) => {
    if (closed) {
      socket.destroy();
      return false;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
    return true;
  };

  const recordDenied = (target, reason) => {
    if (blockedAttempts.length < 200) {
      blockedAttempts.push(Object.freeze({ target: String(target).slice(0, 256), reason }));
    }
  };

  const server = createServer((req, res) => {
    let target;
    try {
      target = new URL(req.url ?? "");
    } catch {
      recordDenied(req.url ?? "", "malformed request URL");
      res.writeHead(403).end();
      return;
    }
    const targetPort = target.port === "" ? 80 : Number(target.port);
    const targetHost = target.hostname.toLowerCase();
    const hostMatches = allowed !== null && (
      targetHost === allowed.hostname
      || (allowed.hostname === "localhost" && targetHost === "127.0.0.1")
    );
    const isAllowed = allowed !== null
      && target.protocol === "http:"
      && targetPort === allowed.port
      && hostMatches;
    if (!isAllowed) {
      recordDenied(target.href, "denied by Ninerr Vision zero-egress proxy");
      res.writeHead(403).end("Blocked by Ninerr Vision offline policy");
      return;
    }
    const upstream = httpRequest(
      { host: allowed.host, port: allowed.port, method: req.method, path: `${target.pathname}${target.search}`, headers: { ...req.headers, host: target.host } },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });

  server.on("connection", (socket) => { track(socket); });
  server.on("connect", (req, client) => {
    recordDenied(`CONNECT ${req.url ?? ""}`, "HTTPS/tunnel CONNECT denied by Ninerr Vision offline policy");
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();

  return Object.freeze({
    url: `http://127.0.0.1:${port}`,
    port,
    allowedOrigin: allowed,
    blockedAttempts: () => blockedAttempts.slice(),
    async close() {
      closed = true;
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  });
}

class CdpConnection {
  #ws;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Map();

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (typeof msg.id === "number") {
        const entry = this.#pending.get(msg.id);
        if (entry) {
          this.#pending.delete(msg.id);
          if (msg.error) entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message ?? JSON.stringify(msg.error)}`));
          else entry.resolve(msg.result ?? {});
        }
      } else if (typeof msg.method === "string") {
        const handlers = this.#listeners.get(msg.method);
        if (handlers) {
          for (const fn of handlers) {
            try {
              fn(msg.params ?? {}, msg.sessionId);
            } catch {
              // isolate event handler errors
            }
          }
        }
      }
    });
    ws.addEventListener("close", () => {
      for (const entry of this.#pending.values()) entry.reject(new Error("CDP WebSocket closed"));
      this.#pending.clear();
    });
  }

  on(method, fn) {
    let set = this.#listeners.get(method);
    if (!set) {
      set = new Set();
      this.#listeners.set(method, set);
    }
    set.add(fn);
    return () => set.delete(fn);
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`CDP ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(id, {
        method,
        timer,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });
      const payload = { id, method, params, ...(sessionId ? { sessionId } : {}) };
      this.#ws.send(JSON.stringify(payload));
    });
  }

  async close() {
    for (const entry of this.#pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("CDP connection closed"));
    }
    this.#pending.clear();
    this.#listeners.clear();
    try {
      if (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING) {
        const closed = new Promise((resolve) => {
          const t = setTimeout(resolve, 500);
          this.#ws.addEventListener("close", () => { clearTimeout(t); resolve(); }, { once: true });
          this.#ws.addEventListener("error", () => { clearTimeout(t); resolve(); }, { once: true });
        });
        this.#ws.close();
        await closed;
      }
    } catch {
      // ignore close errors
    }
  }
}

function connectWebSocket(wsUrl, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error(`CDP WebSocket connect timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve(new CdpConnection(ws));
    }, { once: true });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error(`CDP WebSocket failed to connect to ${wsUrl}`));
    }, { once: true });
  });
}

function terminateTree(child) {
  if (!child || child.exitCode !== null) return;
  try {
    child.kill("SIGKILL");
  } catch {
    // fallback below
  }
  if (process.platform === "win32" && typeof child.pid === "number") {
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5_000 });
    } catch {
      // already exited
    }
  }
}

/**
 * Launch an ephemeral, 3-layer zero-egress contained local Chromium/Edge instance,
 * run `fn(session)`, and guarantee full process-tree + proxy + temp-dir cleanup.
 */
export async function withContainedBrowser({ browserPath, allowedOrigin = null, timeoutMs = DEFAULT_TIMEOUT_MS } = {}, fn) {
  const executable = discoverBrowser(browserPath);
  if (!executable) {
    throw new Error("No local Chromium, Chrome, or Edge browser found. Install Edge/Chrome/Chromium or set NINERR_BROWSER.");
  }

  const proxy = await startStrictContainmentProxy({ allowedOrigin });
  const userDataDir = mkdtempSync(join(tmpdir(), "ninerr-vision-"));
  const cdpBlockedRequests = [];

  // Layer 2: lock browser networking strictly to our loopback policy proxy.
  const hostRule = proxy.allowedOrigin
    ? "MAP * ~NOTFOUND , EXCLUDE 127.0.0.1 , EXCLUDE localhost"
    : "MAP * ~NOTFOUND , EXCLUDE 127.0.0.1";
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-domain-reliability",
    "--disable-sync",
    "--metrics-recording-only",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,InterestFeedContentSuggestions",
    "--disable-quic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    `--proxy-server=${proxy.url}`,
    "--proxy-bypass-list=<-loopback>",
    `--host-resolver-rules=${hostRule}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    ...(process.platform === "linux" && typeof process.getuid === "function" && process.getuid() === 0 ? ["--no-sandbox"] : []),
    "about:blank",
  ];

  const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
  let cdp = null;

  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let stderrBuf = "";
      const timer = setTimeout(() => {
        reject(new Error(`Browser did not emit DevTools WebSocket URL within ${timeoutMs}ms. stderr: ${stderrBuf.slice(0, 400)}`));
      }, timeoutMs);
      const onExit = (code) => {
        clearTimeout(timer);
        reject(new Error(`Browser exited prematurely with code ${code}. stderr: ${stderrBuf.slice(0, 400)}`));
      };
      child.once("exit", onExit);
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.stderr.on("data", (chunk) => {
        stderrBuf += chunk.toString("utf8");
        const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/u.exec(stderrBuf);
        if (match) {
          clearTimeout(timer);
          child.off("exit", onExit);
          resolve(match[1]);
        }
      });
    });

    cdp = await connectWebSocket(wsUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    // Layer 3: CDP Fetch.enable blocks any network request outside data:, about:, or allowed loopback origin.
    const allowedExact = proxy.allowedOrigin ? proxy.allowedOrigin.origin : null;
    cdp.on("Fetch.requestPaused", ({ requestId, request }, sid) => {
      if (sid !== sessionId) return;
      const reqUrl = String(request?.url ?? "");
      let ok = reqUrl === "about:blank" || reqUrl.startsWith("data:");
      if (!ok && allowedExact !== null) {
        try {
          ok = new URL(reqUrl).origin === allowedExact;
        } catch {
          ok = false;
        }
      }
      if (ok) {
        void cdp.send("Fetch.continueRequest", { requestId }, sessionId).catch(() => {});
      } else {
        if (cdpBlockedRequests.length < 200) cdpBlockedRequests.push(reqUrl.slice(0, 256));
        void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => {});
      }
    });

    await cdp.send("Page.enable", {}, sessionId);
    await cdp.send("DOM.enable", {}, sessionId);
    await cdp.send("CSS.enable", {}, sessionId);
    await cdp.send("Runtime.enable", {}, sessionId);
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, sessionId);

    const session = {
      executable,
      sessionId,
      send: (method, params = {}) => cdp.send(method, params, sessionId, timeoutMs),
      async setHtml(html) {
        const { frameTree } = await cdp.send("Page.getFrameTree", {}, sessionId);
        await cdp.send("Page.setDocumentContent", { frameId: frameTree.frame.id, html }, sessionId);
        // Wait two animation frames for layout and styles to settle deterministically.
        await cdp.send("Runtime.evaluate", {
          expression: "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
          awaitPromise: true,
        }, sessionId);
      },
      async navigate(url) {
        if (!proxy.allowedOrigin) throw new Error("navigate() requires an explicit allowedOrigin");
        const parsed = new URL(url);
        if (parsed.origin !== proxy.allowedOrigin.origin) {
          throw new Error(`navigate() refused origin ${parsed.origin}; only ${proxy.allowedOrigin.origin} is allowed`);
        }
        const loaded = new Promise((resolve) => {
          const off = cdp.on("Page.loadEventFired", (_p, sid) => {
            if (sid === sessionId) {
              off();
              resolve();
            }
          });
        });
        await cdp.send("Page.navigate", { url }, sessionId);
        await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 10_000))]);
        await cdp.send("Runtime.evaluate", {
          expression: "new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))",
          awaitPromise: true,
        }, sessionId);
      },
      egressReport() {
        return {
          proxyBlocked: proxy.blockedAttempts(),
          cdpBlocked: cdpBlockedRequests.slice(),
          totalBlocked: proxy.blockedAttempts().length + cdpBlockedRequests.length,
        };
      },
    };

    return await fn(session);
  } finally {
    if (cdp) {
      await cdp.send("Browser.close", {}, undefined, 2_000).catch(() => {});
      await cdp.close();
    }
    terminateTree(child);
    if (child.exitCode === null) {
      await new Promise((resolve) => {
        const t = setTimeout(resolve, 2_000);
        child.once("exit", () => { clearTimeout(t); resolve(); });
      });
    }
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref?.();
    await proxy.close().catch(() => {});
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 80 });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
    }
  }
}
