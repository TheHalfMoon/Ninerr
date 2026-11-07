// R04: what a whole-process trace of the packaged app shows, as plain functions over its text, so
// the reading is testable without Electron. Linux only for now: strace follows the main process,
// renderers, utility processes and any child at the system-call level, whichever library made
// the call. macOS and Windows need other tools, and no zero-egress claim holds until they have them.
//
// The trace is taken with strace -yy, which names each socket as it is used: UDP:[local->peer]
// where the kernel can say so, or only its local end or inode, UDP:[0.0.0.0:52905] or TCP:[16218],
// which a connect does not change. So a socket's peer also comes from its own connect, by that
// name, across the threads of every process. Two sockets sharing a name only make this stricter.

const CALL = /^(?<pid>\d+)\s+(?:<\.\.\. )?(?<call>connect|sendto|sendmsg|sendmmsg|write)\((?<fd>\d+)(?:<(?<socket>(?:->|[^>])*)>)?/u;
const FAMILY = /sa_family=(?<family>AF_INET6?)\b/u;
const PORT = /sin6?_port=htons\((?<port>\d+)\)/u;
const V4 = /sin_addr=inet_addr\("(?<address>[0-9.]+)"/u;
const V6 = /inet_pton\(AF_INET6,\s*"(?<address>[0-9a-fA-F:.]+)"/u;
const NAMED = /^(?<transport>TCP|UDP)(?:v6)?:\[(?<ends>.*)\]$/u;
const OWN_NAME = /^(?<kind>TCP|UDP|socket)(?:v6)?:\[(?:.*:)?(?<id>\d+)\]$/u;

/** What identifies a socket whose name gives no peer: its kind, and its inode or local port. */
function ownName(socket) {
  const found = OWN_NAME.exec(socket);
  return found === null || socket.includes("->") ? null : `${found.groups.kind}:${found.groups.id}`;
}

/** The peer a socket's name gives, as address and port, or null when it has none yet. */
function peerOf(ends) {
  const arrow = ends.indexOf("->");
  if (arrow < 0) return null;
  const peer = ends.slice(arrow + 2);
  const v6 = /^\[(?<address>[^\]]*)\]:(?<port>\d+)$/u.exec(peer);
  const plain = /^(?<address>[^:]*):(?<port>\d+)$/u.exec(peer);
  const found = v6 ?? plain;
  return found === null ? { address: null, port: null } : { address: found.groups.address, port: Number(found.groups.port) };
}

/**
 * Every attempt to reach an internet address in a trace written by
 * `strace -f -yy -e trace=connect,sendto,sendmsg,sendmmsg,write`, whether it succeeded or not:
 * a connect or send that names an address, and a send or write on a socket with a peer, named or
 * connected. A name that was connected twice answers for both, and its order in the trace does
 * not matter, so a send is never excused by which came first. `transport` is TCP, UDP or null when
 * the trace did not name the socket. Unix sockets, netlink and files have no internet address.
 */
export function networkAttempts(trace) {
  const calls = [];
  // Every address each socket was connected to, by its own name.
  const connected = new Map();
  for (const line of trace.split("\n")) {
    const call = CALL.exec(line);
    if (call === null) continue;
    const { pid, call: name, socket } = call.groups;
    const named = socket === undefined ? null : NAMED.exec(socket);
    const own = socket === undefined ? null : ownName(socket);
    const family = FAMILY.exec(line);
    const address = family === null ? undefined : (family.groups.family === "AF_INET" ? V4 : V6).exec(line)?.groups.address ?? null;
    const port = family === null ? undefined : PORT.exec(line)?.groups.port;
    const seen = { pid: Number(pid), call: name, transport: named?.groups.transport ?? null, named, own, address, port: port === undefined ? null : Number(port) };
    calls.push(seen);
    if (name === "connect" && family !== null && own !== null) connected.set(own, [...(connected.get(own) ?? []), seen]);
  }
  const attempts = [];
  for (const { named, own, ...seen } of calls) {
    if (seen.address !== undefined) attempts.push(seen);
    else if (seen.call !== "connect") {
      const peer = named === null ? null : peerOf(named.groups.ends);
      if (peer !== null) attempts.push({ ...seen, ...peer });
      else for (const { address, port, transport } of connected.get(own) ?? []) attempts.push({ ...seen, transport, address, port });
    }
  }
  return attempts;
}

/** Whether an address is this computer's own. An address that could not be read is not. */
export function isLoopback(address) {
  if (address === null) return false;
  if (/^127\.\d+\.\d+\.\d+$/u.test(address) || address === "::1") return true;
  const mapped = /^::ffff:(?<v4>[0-9.]+)$/iu.exec(address);
  return mapped !== null && isLoopback(mapped.groups.v4);
}

/**
 * A connect on a UDP socket that sends nothing: it only asks the system for a route, and no packet
 * leaves. Chromium asks this of a public address to learn whether IPv6 is reachable. It is reported,
 * not forbidden, and a send to that peer is still forbidden. A socket the trace did not name is
 * not assumed to be UDP.
 */
export const isRouteQuery = ({ call, transport }) => call === "connect" && transport === "UDP";

/**
 * What a run may not do: any attempt off this computer, and any DNS query, wherever it is sent,
 * since 127.0.0.53 forwards a name off the computer.
 */
export function forbiddenAttempts(attempts) {
  return attempts.filter((attempt) => !isRouteQuery(attempt) && (!isLoopback(attempt.address) || attempt.port === 53));
}

/** The route queries off this computer, to report. */
export const routeQueries = (attempts) => attempts.filter((attempt) => isRouteQuery(attempt) && !isLoopback(attempt.address));
