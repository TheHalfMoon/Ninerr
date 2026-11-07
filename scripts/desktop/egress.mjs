// R04: what a whole-process trace of the packaged app shows, as plain functions over its text, so
// the reading is testable without Electron. Linux only for now: strace follows the main process,
// renderers, utility processes and any child at the system-call level, whichever library made
// the call. macOS and Windows need other tools, and no zero-egress claim holds until they have them.

const CALL = /^(?<pid>\d+)\s+(?:<\.\.\. )?(?<call>connect|sendto|sendmsg|sendmmsg)\b/u;
const FAMILY = /sa_family=(?<family>AF_INET6?)\b/u;
const PORT = /sin6?_port=htons\((?<port>\d+)\)/u;
const V4 = /(?:inet_addr\("|sin_addr=inet_addr\(")(?<address>[0-9.]+)"/u;
const V6 = /inet_pton\(AF_INET6,\s*"(?<address>[0-9a-fA-F:.]+)"/u;

/**
 * Every attempt to reach an internet address in a trace written by
 * `strace -f -e trace=connect,sendto,sendmsg,sendmmsg`, whether it succeeded or not.
 * Unix sockets and netlink have no such address, and a send on a connected socket names none
 * (its connect was already read).
 */
export function networkAttempts(trace) {
  const attempts = [];
  for (const line of trace.split("\n")) {
    const call = CALL.exec(line);
    const family = FAMILY.exec(line);
    if (call === null || family === null) continue;
    const address = (family.groups.family === "AF_INET" ? V4 : V6).exec(line)?.groups.address ?? null;
    const port = PORT.exec(line)?.groups.port;
    attempts.push({ pid: Number(call.groups.pid), call: call.groups.call, family: family.groups.family, address, port: port === undefined ? null : Number(port) });
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
 * What a run may not do: any attempt off this computer, and any DNS query, wherever it is sent,
 * since 127.0.0.53 forwards a name off the computer.
 */
export function forbiddenAttempts(attempts) {
  return attempts.filter(({ address, port }) => !isLoopback(address) || port === 53);
}
