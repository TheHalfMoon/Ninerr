// Preload (node --import) for product-surface tests. These Node ways out of this computer
// are trapped: TCP sockets (and so net, tls, http, https, http2 and fetch, which all
// connect through net.Socket), DNS, UDP, helper processes, worker threads, and the raw
// bindings and native addons behind them. A connection to a loopback address is allowed (the editor and the MCP relay talk
// to Ninerr on 127.0.0.1); any other connection, any DNS lookup of a name other than
// localhost, any UDP socket and any helper process is refused and reported on stderr as
// "NINERR-NETWORK-ATTEMPT <what>", so a test can assert there were none.
import { createRequire, syncBuiltinESMExports } from "node:module";

const require = createRequire(import.meta.url);
const net = require("node:net");
const report = (label) => {
  process.stderr.write(`NINERR-NETWORK-ATTEMPT ${label}\n`);
  return new Error(`network access attempted: ${label}`);
};
const loopback = (host) => {
  if (host === undefined || host === null || host === "" || host === "localhost") return true;
  const bare = String(host).replace(/^\[|\]$/gu, "");
  return net.isIP(bare) !== 0 && (bare === "::1" || bare.startsWith("127.") || bare.startsWith("::ffff:127."));
};
const targetOf = (args) => {
  const [first] = args;
  if (Array.isArray(first)) return targetOf(first);
  if (first !== null && typeof first === "object") return { host: first.host ?? first.hostname, path: first.path };
  if (typeof first === "string" && !/^\d+$/u.test(first)) return { path: first };
  return { host: typeof args[1] === "string" ? args[1] : undefined };
};

const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function guardedConnect(...args) {
  const { host, path } = targetOf(args);
  // Node's own rule: only a non-empty string path is a local (IPC) socket. http.Agent
  // passes path: null for TCP.
  const ipc = typeof path === "string" && path !== "";
  if (!ipc && !loopback(host)) throw report(`connect ${host}`);
  // A caller's own lookup could turn "localhost" into any address: refuse it.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0]; // net.connect passes [options, callback]
  const options = first !== null && typeof first === "object" && !Array.isArray(first) ? first : null;
  if (!ipc && options && typeof options.lookup === "function") throw report(`connect ${host} with a custom lookup`);
  return connect.apply(this, args);
};
const dns = require("node:dns");
const DNS = ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCname", "resolveMx", "resolveNs", "resolveTxt", "resolveSrv", "reverse"];
for (const holder of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const key of DNS) {
    if (typeof holder[key] !== "function") continue;
    const original = holder[key];
    holder[key] = function guardedDns(name, ...rest) {
      if (key === "lookup" && loopback(name)) return original.call(this, name, ...rest);
      const error = report(`dns.${key} ${String(name)}`);
      // A callback-style call fails that request, as a real resolution failure would,
      // rather than throwing inside net's internals and crashing the process.
      const callback = rest.at(-1);
      if (typeof callback === "function") {
        process.nextTick(() => callback(Object.assign(error, { code: "ENOTFOUND" })));
        return undefined;
      }
      if (holder === dns.promises || holder === dns.promises.Resolver.prototype) return Promise.reject(error);
      throw error;
    };
  }
}
const dgram = require("node:dgram");
dgram.createSocket = () => {
  throw report("dgram.createSocket");
};
dgram.Socket.prototype.bind = function guardedBind() {
  throw report("dgram.Socket#bind");
};
dgram.Socket.prototype.send = function guardedSend() {
  throw report("dgram.Socket#send");
};
const childProcess = require("node:child_process");
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  childProcess[key] = () => {
    throw report(`child_process.${key}`);
  };
}
childProcess.ChildProcess.prototype.spawn = function guardedSpawn() {
  throw report("ChildProcess#spawn");
};
// Workers do not inherit this preload, so they are refused rather than left untrapped.
const threads = require("node:worker_threads");
threads.Worker = class RefusedWorker {
  constructor() {
    throw report("worker_threads.Worker");
  }
};
// The raw handles and native addons the trapped modules are built on.
process.binding = (name) => {
  throw report(`process.binding ${String(name)}`);
};
// One native addon is allowed: Koffi's prebuilt module, the native boundary to the Windows
// security API that the founder authorized for #268. It is allowed only from this repository's
// own installed copy, by its exact path; studio-host binds through it only the advapi32.dll and
// kernel32.dll functions listed in windows-security.ts (a test holds it to them).
const dlopen = process.dlopen;
const KOFFI_LIBRARIES = new Set(["advapi32.dll", "kernel32.dll"]);
const KOFFI = require("node:url").fileURLToPath(new URL(`../../node_modules/@koromix/koffi-${process.platform}-${process.arch}/${process.platform}_${process.arch}/koffi.node`, import.meta.url));
// Node may name the file with Windows's long-path prefix; paths compare without it, and without
// case on Windows.
const canonical = (path) => {
  const real = require("node:fs").realpathSync(String(path).replace(/^\\\\\?\\/u, ""));
  return process.platform === "win32" ? real.toLowerCase() : real;
};
process.dlopen = (module, filename, ...rest) => {
  let allowed = false;
  try {
    allowed = canonical(filename) === canonical(KOFFI);
  } catch {
    allowed = false;
  }
  if (!allowed) throw report(`process.dlopen ${String(filename)}`);
  const loaded = dlopen.call(process, module, filename, ...rest);
  // Koffi can open any library, a network one too, without process.dlopen: through it, only the
  // two the native boundary binds may be opened (from the review of #346). Wrapped here, before
  // Koffi's own loader reads the function.
  const load = module.exports?.load;
  if (typeof load === "function") {
    module.exports.load = (name, ...args) => {
      if (!KOFFI_LIBRARIES.has(String(name).toLowerCase())) throw report(`koffi.load ${String(name)}`);
      return load.call(module.exports, name, ...args);
    };
  }
  return loaded;
};
syncBuiltinESMExports();
