// What the Ninerr desktop window may do, as plain functions over URLs, so the rules are
// testable without Electron. The window shows the editor the studio host serves on
// 127.0.0.1, and nothing else: it never navigates away, opens no windows, and the page's
// own requests go only to that host.

/** The editor's origin, from the host's URL (http://127.0.0.1:<port>). */
export function editorOrigin(hostUrl) {
  const url = new URL(hostUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port === "") throw new Error("the desktop app only shows a Ninerr host on 127.0.0.1");
  return url.origin;
}

/** May the window's page navigate to `target`? Only within the editor's own origin. */
export function mayNavigate(origin, target) {
  try {
    return new URL(target).origin === origin;
  } catch {
    return false;
  }
}

// Schemes a page can reach without the network, which Chromium still reports: the
// renderer's sandboxed frame (about:srcdoc), images a design holds inline (data:), and the
// editor's own object URLs (blob:).
const LOCAL_SCHEMES = new Set(["data:", "blob:", "about:"]);

/**
 * May the page request `target`? Only the editor's origin and local schemes, and
 * developer tools' own devtools: pages when they are allowed (never in a packaged app).
 */
export function mayRequest(origin, target, { devtools = false } = {}) {
  let url;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (LOCAL_SCHEMES.has(url.protocol)) return true;
  if (url.protocol === "devtools:") return devtools;
  return url.origin === origin;
}

/**
 * WebRTC may use no UDP that is not proxied (#395). A page's STUN or peer traffic is governed by
 * no request rule or content policy, so without this the editor could send UDP off the computer.
 */
export const WEBRTC_IP_POLICY = "disable_non_proxied_udp";

/**
 * The proxy every request that would use one is sent to: a sink, a port on this computer the app
 * itself holds, which closes every connection (#395). WebRTC's TCP (TURN, ICE-TCP) is governed by
 * no request rule and would go direct or through the system's proxy; here it goes nowhere. The
 * port is the app's own, chosen when it starts, so no other account on the computer can listen
 * there and answer as a proxy. Chromium never proxies loopback or link-local addresses on its own,
 * so that rule is taken away (<-loopback>), and only the host's own port on 127.0.0.1 is left
 * direct: any other local port, a link-local peer or 169.254.169.254 goes to the sink too.
 * A person who starts the app with --proxy-server has chosen otherwise. A proxy given by name, or by
 * any address but 127.0.0.1, also needs their own --host-resolver-rules (NO_NAME_RESOLUTION).
 */
export function sinkProxy(sinkPort, hostPort) {
  for (const port of [sinkPort, hostPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`not a port: ${port}`);
  }
  return Object.freeze({ proxyRules: `http://127.0.0.1:${sinkPort}`, proxyBypassRules: `<-loopback>;127.0.0.1:${hostPort}` });
}

/**
 * Every name Chromium would look up is not found, except 127.0.0.1, where the host is (#395). The
 * editor and host need no name, and a page's <link rel=dns-prefetch>, or Chromium's own proxy
 * discovery (wpad), would otherwise send DNS queries off the computer, which no request rule sees.
 * Chromium applies the rule to IP literals too, so any other address is unreachable as well,
 * [::1] among them. A person who gives their own --host-resolver-rules has chosen otherwise.
 */
export const NO_NAME_RESOLUTION = "MAP * ~NOTFOUND, EXCLUDE 127.0.0.1";

/** The web preferences every Ninerr window gets: no Node, isolated and sandboxed. */
export function windowPreferences(preload, { devTools = false } = {}) {
  return {
    preload,
    devTools,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    spellcheck: false,
    safeDialogs: true,
    // No page may reach a radio: Bluetooth devices are not offered (and every chooser is refused).
    disableBlinkFeatures: "WebBluetooth",
  };
}
