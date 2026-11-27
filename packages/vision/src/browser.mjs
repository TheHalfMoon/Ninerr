// Zero-dependency local browser controller using Node 22/24 built-in WebSocket CDP.
// Enforces 3-layer cross-platform zero-egress containment:
//   Layer 1: In-process loopback policy proxy refusing every non-allowed host/CONNECT/UPGRADE.
//   Layer 2: Chromium/Edge flags (--proxy-server, --proxy-bypass-list=<-loopback>,
//            --host-resolver-rules, --disable-quic, --force-webrtc-ip-handling-policy,
//            and telemetry/background-networking disable flags).
//   Layer 3: CDP Fetch.enable across the primary page AND all auto-attached sub-targets
//            (workers, OOPIFs, popups), aborting every request outside about:blank, data:,
//            and any explicitly human-authorized local preview origin.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_STDERR_BYTES = 16_384;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

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
    throw new Error("local preview origin must use http:// on loopback (127.0.0.1, [::1], or localhost)");
  }
  const hostname = parsed.hostname.toLowerCase();
  const bareHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (bareHost !== "127.0.0.1" && bareHost !== "localhost" && bareHost !== "::1") {
    throw new Error(`preview origin host ${hostname} is not loopback; Ninerr Vision blocks external origins`);
  }
  const port = parsed.port === "" ? 80 : Number(parsed.port);
  const dialHost = bareHost === "localhost" ? "127.0.0.1" : bareHost;
  return Object.freeze({ origin: parsed.origin, host: dialHost, bareHost, hostname, port });
}

function forwardHeaders(rawHeaders, targetHostHeader) {
  const out = {};
  for (const [k, v] of Object.entries(rawHeaders ?? {})) {
    if (HOP_BY_HOP_HEADERS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  out.host = targetHostHeader;
  return out;
}

/**
 * Layer 1 containment: loopback HTTP/CONNECT/UPGRADE proxy that denies ALL traffic except an
 * optional explicitly allowed loopback preview origin, recording every blocked egress attempt.
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
    const targetHostname = target.hostname.toLowerCase();
    const targetBare = targetHostname.startsWith("[") && targetHostname.endsWith("]")
      ? targetHostname.slice(1, -1)
      : targetHostname;
    const hostMatches = allowed !== null && (
      targetBare === allowed.bareHost
      || (allowed.bareHost === "localhost" && targetBare === "127.0.0.1")
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
      {
        host: allowed.host,
        port: allowed.port,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: forwardHeaders(req.headers, target.host),
      },
      (reply) => {
        res.writeHead(reply.statusCode ?? 502, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on("close", () => {
      if (!res.writableEnded) upstream.destroy();
    });
    req.on("error", () => upstream.destroy());
    req.pipe(upstream);
  });

  server.on("connection", (socket) => { track(socket); });
  server.on("connect", (req, client) => {
    recordDenied(`CONNECT ${req.url ?? ""}`, "HTTPS/tunnel CONNECT denied by Ninerr Vision offline policy");
    client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  server.on("upgrade", (req, socket) => {
    recordDenied(`UPGRADE ${req.url ?? ""}`, "HTTP Upgrade denied by Ninerr Vision offline policy");
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
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
      for (const entry of this.#pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("CDP WebSocket closed"));
      }
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
    if (this.#ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`CDP ${method}: WebSocket is not open`));
    }
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
      try {
        this.#ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
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
    timer.unref?.();
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

function isProcessRunning(child) {
  return child !== null && child !== undefined && child.exitCode === null && child.signalCode === null;
}

function terminateTree(child) {
  if (!isProcessRunning(child)) return;
  if (process.platform === "win32" && typeof child.pid === "number") {
    // Run taskkill /T FIRST while parent PID is still alive so renderer/GPU/network children are killed too.
    try {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", timeout: 5_000 });
      return;
    } catch {
      // fall through to direct kill
    }
  } else if (process.platform !== "win32" && typeof child.pid === "number") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // fall through to direct kill
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // already exited
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
  const cdpBlockedRequests = [];
  let userDataDir = null;
  let child = null;
  let cdp = null;

  try {
    userDataDir = mkdtempSync(join(tmpdir(), "ninerr-vision-"));

    // Layer 2: lock browser networking strictly to our loopback policy proxy.
    const excludes = ["EXCLUDE 127.0.0.1"];
    if (proxy.allowedOrigin?.bareHost === "localhost") excludes.push("EXCLUDE localhost");
    if (proxy.allowedOrigin?.bareHost === "::1") excludes.push("EXCLUDE ::1");
    const hostRule = `MAP * ~NOTFOUND , ${excludes.join(" , ")}`;

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

    child = spawn(executable, args, {
      stdio: ["ignore", "ignore", "pipe"],
      detached: process.platform !== "win32",
    });

    const wsUrl = await new Promise((resolve, reject) => {
      let stderrBuf = "";
      let settled = false;
      const cleanup = () => {
        clearTimeout(timer);
        child.off("exit", onExit);
        child.off("error", onError);
        child.stderr?.off("data", onData);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Browser did not emit DevTools WebSocket URL within ${timeoutMs}ms. stderr: ${stderrBuf.slice(0, 400)}`));
      }, timeoutMs);
      timer.unref?.();
      const onExit = (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Browser exited prematurely with code ${code}. stderr: ${stderrBuf.slice(0, 400)}`));
      };
      const onError = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };
      const onData = (chunk) => {
        if (stderrBuf.length < MAX_STDERR_BYTES) {
          stderrBuf += chunk.toString("utf8").slice(0, MAX_STDERR_BYTES - stderrBuf.length);
        }
        const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/u.exec(stderrBuf);
        if (match && !settled) {
          settled = true;
          cleanup();
          // Drain remaining stderr so Chromium never blocks on a full stderr pipe.
          child.stderr?.resume();
          resolve(match[1]);
        }
      };
      child.once("exit", onExit);
      child.once("error", onError);
      child.stderr.on("data", onData);
    });

    cdp = await connectWebSocket(wsUrl);
    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });

    // Layer 3: CDP Fetch.enable blocks any network request outside data:, about:, or allowed loopback origin
    // across the primary page AND every auto-attached sub-target (workers, OOPIFs, popups).
    const allowedExact = proxy.allowedOrigin ? proxy.allowedOrigin.origin : null;
    const attachedSessions = new Set([sessionId]);

    cdp.on("Fetch.requestPaused", ({ requestId, request }, sid) => {
      if (!sid || !attachedSessions.has(sid)) return;
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
        void cdp.send("Fetch.continueRequest", { requestId }, sid).catch(() => {});
      } else {
        if (cdpBlockedRequests.length < 200) cdpBlockedRequests.push(reqUrl.slice(0, 256));
        void cdp.send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, sid).catch(() => {});
      }
    });

    cdp.on("Target.attachedToTarget", ({ sessionId: childSid, waitingForDebugger }) => {
      if (!childSid) return;
      attachedSessions.add(childSid);
      void (async () => {
        await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] }, childSid).catch(() => {});
        if (waitingForDebugger) {
          await cdp.send("Runtime.runIfWaitingForDebugger", {}, childSid).catch(() => {});
        }
      })();
    });

    await cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
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
        let off = () => {};
        let timer = null;
        try {
          const loaded = new Promise((resolve) => {
            off = cdp.on("Page.loadEventFired", (_p, sid) => {
              if (sid === sessionId) resolve();
            });
            timer = setTimeout(resolve, 10_000);
            timer.unref?.();
          });
          await cdp.send("Page.navigate", { url }, sessionId);
          await loaded;
        } finally {
          off();
          if (timer !== null) clearTimeout(timer);
        }
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
    if (child) {
      terminateTree(child);
      if (isProcessRunning(child)) {
        await new Promise((resolve) => {
          const t = setTimeout(resolve, 2_000);
          t.unref?.();
          child.once("exit", () => { clearTimeout(t); resolve(); });
        });
      }
      child.stderr?.destroy();
      child.unref?.();
    }
    await proxy.close().catch(() => {});
    if (userDataDir) {
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
}
