// R04 on macOS and Windows: what a packet capture tagged by process shows, as plain functions over
// its text, so the reading is testable without the capture. A capture sees what leaves a network
// interface, with the process the system charges it to. Unlike Linux's trace it sees no route
// query, and no lookup the system makes for an app (mDNSResponder on macOS, the DNS Client service
// on Windows): those are charged to the system's process, not the app's.

import { isLoopback } from "./egress.mjs";

// macOS: `tcpdump -i pktap,all -k NP -nn -l` (plain pktap leaves loopback out), which names each packet's interface and process.
// Its metadata can hold parentheses (Ninerr Helper (Renderer)), and an IPv6 end holds colons.
const MAC_LINE = /^\S+\s+\((?<meta>.*?)\)\s+IP(?<v6>6)?\s+(?<src>\S+)\s+>\s+(?<dst>\S+?):\s/u;
const MAC_PROC = /\bproc\s+(?<name>[^:,]*):(?<pid>\d+)/u;

/** An address and port from tcpdump's address.port, for IPv4 and IPv6 alike. */
function splitEnd(end) {
  const dot = end.lastIndexOf(".");
  if (dot < 0) return { address: end, port: null };
  const port = end.slice(dot + 1);
  return /^\d+$/u.test(port) ? { address: end.slice(0, dot), port: Number(port) } : { address: end, port: null };
}

/**
 * Every packet a pktap capture shows leaving for an internet address, with its process. A packet
 * whose process could not be read is kept, with a null pid, and is never taken for another's.
 * Where the capture names no direction, as on the macOS runner, a packet addressed to one of this
 * computer's own addresses (`local`, besides loopback) came in, and any other went out.
 */
export function macPackets(text, local = new Set()) {
  const packets = [];
  for (const line of text.split("\n")) {
    const found = MAC_LINE.exec(line);
    if (found === null) continue;
    const meta = found.groups.meta;
    const direction = /(?:^|,\s*)(?<way>in|out)(?:,|$)/u.exec(meta)?.groups.way ?? null;
    if (direction === "in") continue;
    if (direction === null && local.has(splitEnd(found.groups.dst).address)) continue;
    const proc = MAC_PROC.exec(meta);
    packets.push({ pid: proc === null ? null : Number(proc.groups.pid), name: proc?.groups.name.trim() ?? null, ...splitEnd(found.groups.dst) });
  }
  return packets;
}

// Windows: the Microsoft-Windows-Kernel-Network provider, written as XML by tracerpt. These event
// ids are sends and connects; receives name this computer as their destination and are left out.
const WINDOWS_OUTBOUND = new Set([10, 12, 16, 26, 28, 32, 42, 58]);
const EVENT = /<Event\b[\s\S]*?<\/Event>/gu;
const EVENT_ID = /<EventID>(?<id>\d+)<\/EventID>/u;
const DATA = (name) => new RegExp(`<Data Name="${name}">(?<value>[^<]*)</Data>`, "u");

/** Every outbound network event in tracerpt's XML, with the process it was charged to. */
export function windowsEvents(xml) {
  const events = [];
  for (const [event] of xml.matchAll(EVENT)) {
    const id = Number(EVENT_ID.exec(event)?.groups.id);
    if (!WINDOWS_OUTBOUND.has(id)) continue;
    const pid = DATA("PID").exec(event)?.groups.value;
    const address = DATA("daddr").exec(event)?.groups.value ?? null;
    const port = DATA("dport").exec(event)?.groups.value;
    events.push({ id, pid: pid === undefined ? null : Number(pid), address, port: port === undefined ? null : Number(port) });
  }
  return events;
}

/**
 * The outbound events off this computer from `pids`. An event with no readable address counts, as
 * does any DNS query the capture charges to the app.
 */
export function forbiddenOutbound(events, pids) {
  return events.filter(({ pid, address, port }) => pid !== null && pids.has(pid) && (!isLoopback(address) || port === 53));
}

/**
 * Outbound events off this computer that the system charged to no process, to report: on a shared
 * machine the system's own traffic has none, so they cannot fail a run, and an app's packet that
 * lost its process would be among them.
 */
export function unattributedOutbound(events) {
  return events.filter(({ pid, address }) => pid === null && !isLoopback(address));
}
