// R04: what a whole-process trace of the packaged app shows, as plain functions over its text, so
// the reading is testable without Electron. Linux only for now: strace follows the main process,
// renderers, utility processes and any child at the system-call level, whichever library made
// the call. macOS and Windows need other tools, and no zero-egress claim holds until they have them.
//
// The trace is taken with strace -yy, which names each socket as it is used: UDP:[local->peer]
// where the kernel can say so, or only its local end or inode, UDP:[0.0.0.0:52905] or TCP:[16218],
// which a connect does not change. So a socket's peer also comes from its own connect, by that
// name, across the threads of every process. Where the reading is unsure, it fails closed.
//
// Not seen by this reading: inbound sockets, raw packet sockets, and egress delegated to another
// program, such as over D-Bus.

/** The calls to trace, for strace's -e trace=. */
export const TRACED_CALLS = "connect,sendto,sendmsg,sendmmsg,write,writev,sendfile,splice,io_uring_setup";

const CALL = /^(?<pid>\d+)\s+(?<call>connect|sendto|sendmsg|sendmmsg|write|writev|sendfile)\((?<fd>\d+)(?:<(?<socket>(?:->|[^>])*)>)?/u;
const SPLICE = /^(?<pid>\d+)\s+splice\(\d+(?:<(?:->|[^>])*>)?,\s*[^,]+,\s*\d+<(?<socket>(?:->|[^>])*)>/u;
// A setup that failed leaves no ring to send through. One that was cut off in the trace counts.
const RING = /^(?<pid>\d+)\s+io_uring_setup\((?!.*=\s*-1\s)/u;
// A resolver reached over a Unix socket, which carries a name off this computer and names no address.
const RESOLVER = /^(?<pid>\d+)\s+connect\(.*sun_path="[^"]*(?:io\.systemd\.Resolve|resolve\/)[^"]*".*= 0/u;
const PORT = /sin6?_port=htons\((?<port>\d+)\)/u;
const V4 = /sin_addr=inet_addr\("(?<address>[0-9.]+)"/u;
const V6 = /inet_pton\(AF_INET6,\s*"(?<address>[0-9a-fA-F:.]+)"/u;
const NAMED = /^(?<transport>TCP|UDP)(?:v6)?:\[(?<ends>.*)\]$/u;

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

/** What identifies a socket across its names: its kind, and its inode or local port. */
function ownName(socket) {
  const local = socket.split("->")[0].replace(/\]?$/u, "");
  const found = /^(?<kind>TCP|UDP|socket)(?:v6)?:\[(?:.*:)?(?<id>\d+)$/u.exec(local);
  return found === null ? null : `${found.groups.kind}:${found.groups.id}`;
}

/** Every internet address in a line, as a sendmmsg can name several, with its port. */
function addressesIn(line) {
  return line.split(/(?=sa_family=)/u).slice(1).flatMap((part) => {
    if (part.startsWith("sa_family=AF_INET6")) return [{ address: V6.exec(part)?.groups.address ?? null, port: PORT.exec(part)?.groups.port }];
    if (part.startsWith("sa_family=AF_INET")) return [{ address: V4.exec(part)?.groups.address ?? null, port: PORT.exec(part)?.groups.port }];
    return [];
  }).map(({ address, port }) => ({ address, port: port === undefined ? null : Number(port) }));
}

/**
 * Every attempt to reach an internet address in a trace written with TRACED_CALLS, whether it
 * succeeded or not: a connect or send that names an address, and a send on a socket with a peer,
 * named or connected. A name connected twice answers for both, and its order in the trace does
 * not matter, so a send is never excused by which came first. A UDP send with no known peer has
 * an unknown address, which is forbidden. A TCP send with none is on a socket this computer
 * accepted, and any TCP connect is read in its own right. `transport` is TCP, UDP or null when
 * the trace did not name the socket. Unix sockets, netlink and files have no internet address.
 */
export function networkAttempts(trace) {
  const calls = [];
  // Every address each socket was connected to, by its own name.
  const connected = new Map();
  const attempts = [];
  for (const line of trace.split("\n")) {
    const ring = RING.exec(line);
    if (ring !== null) {
      // Its calls cannot be traced, so any use of it could carry a send.
      attempts.push({ pid: Number(ring.groups.pid), call: "io_uring_setup", transport: null, address: null, port: null });
      continue;
    }
    const resolver = RESOLVER.exec(line);
    if (resolver !== null) {
      attempts.push({ pid: Number(resolver.groups.pid), call: "connect", transport: "resolver", address: null, port: 53 });
      continue;
    }
    const spliced = SPLICE.exec(line);
    const call = spliced ?? CALL.exec(line);
    if (call === null) continue;
    const { pid, socket } = call.groups;
    const name = spliced === null ? call.groups.call : "splice";
    const named = socket === undefined ? null : NAMED.exec(socket);
    const own = socket === undefined ? null : ownName(socket);
    const addresses = addressesIn(line);
    const seen = { pid: Number(pid), call: name, transport: named?.groups.transport ?? null };
    calls.push({ ...seen, named, own, addresses });
    if (name === "connect" && own !== null) for (const address of addresses) connected.set(own, [...(connected.get(own) ?? []), { ...seen, ...address }]);
  }
  for (const { named, own, addresses, ...seen } of calls) {
    for (const address of addresses) attempts.push({ ...seen, ...address });
    if (addresses.length > 0 || seen.call === "connect" || (named === null && own === null)) continue;
    const peer = named === null ? null : peerOf(named.groups.ends);
    if (peer !== null) attempts.push({ ...seen, ...peer });
    const peers = connected.get(own) ?? [];
    for (const { address, port, transport } of peers) {
      if (peer === null || address !== peer.address || port !== peer.port) attempts.push({ ...seen, transport, address, port });
    }
    if (peer === null && peers.length === 0 && seen.transport === "UDP") attempts.push({ ...seen, address: null, port: null });
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
 * leaves. Chromium is thought to ask this of a public address to learn whether IPv6 is reachable.
 * It is reported, not forbidden, and a send to that peer is still forbidden. A socket the trace
 * did not name is not assumed to be UDP.
 */
export const isRouteQuery = ({ call, transport }) => call === "connect" && transport === "UDP";

/**
 * What a run may not do: any attempt off this computer, a working io_uring, and any DNS query the
 * trace can see: to port 53 anywhere, since 127.0.0.53 forwards a name off the computer, or to
 * systemd's resolver socket. Name lookups over other programs are not seen.
 */
export function forbiddenAttempts(attempts) {
  return attempts.filter((attempt) => !isRouteQuery(attempt) && (!isLoopback(attempt.address) || attempt.port === 53));
}

/** The route queries off this computer, to report. */
export const routeQueries = (attempts) => attempts.filter((attempt) => isRouteQuery(attempt) && !isLoopback(attempt.address));
