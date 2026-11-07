import test from "node:test";
import assert from "node:assert/strict";

import { forbiddenOutbound, macPackets, unattributedOutbound, windowsEvents } from "../scripts/desktop/egress-capture.mjs";

// R04 on macOS and Windows. The sample lines follow each tool's documented shape; the CI run's
// controls show whether the real output reads the same, and print it when it does not.
const MAC = `
12:00:00.000001 (en0, proc Ninerr Helper:812:5D1C, svc BE, out, so) IP 10.0.0.5.52345 > 192.0.2.1.9: UDP, length 1
12:00:00.000002 (lo0, proc Ninerr:800:1A2B, svc BE, out, so) IP 127.0.0.1.50000 > 127.0.0.1.41234: Flags [S]
12:00:00.000003 (en0, proc Ninerr Helper:812:5D1C, svc BE, in, so) IP 192.0.2.1.9 > 10.0.0.5.52345: UDP, length 1
12:00:00.000004 (en0, proc Ninerr Helper (Renderer):813:5D1D, svc BE, out, so) IP6 fe80::1.52345 > 2001:4860:4860::8888.443: Flags [S]
12:00:00.000005 (en0, svc BE, out, so) IP 10.0.0.5.5353 > 224.0.0.251.5353: UDP, length 40
12:00:00.000006 (en0, proc mDNSResponder:90:AAAA, svc BE, out, so) IP 10.0.0.5.55000 > 8.8.8.8.53: UDP, length 30
12:00:00.000007 (en0, proc node:900:BBBB, svc BE, out, so) IP 10.0.0.5.60000 > 192.0.2.1.12: Flags [S]
`;

test("a pktap capture gives each outbound packet with its process and destination", () => {
  assert.deepEqual(macPackets(MAC).map(({ pid, name, address, port }) => [pid, name, address, port]), [
    [812, "Ninerr Helper", "192.0.2.1", 9],
    [800, "Ninerr", "127.0.0.1", 41234],
    [813, "Ninerr Helper (Renderer)", "2001:4860:4860::8888", 443],
    [null, null, "224.0.0.251", 5353],
    [90, "mDNSResponder", "8.8.8.8", 53],
    [900, "node", "192.0.2.1", 12],
  ]);
});

const WINDOWS = `<Events>
<Event xmlns="x"><System><EventID>12</EventID><Execution ProcessID="4" ThreadID="8"/></System><EventData><Data Name="PID">2100</Data><Data Name="size">0</Data><Data Name="daddr">192.0.2.1</Data><Data Name="saddr">10.0.0.5</Data><Data Name="dport">12</Data><Data Name="sport">60000</Data></EventData></Event>
<Event xmlns="x"><System><EventID>42</EventID></System><EventData><Data Name="PID">2100</Data><Data Name="daddr">192.0.2.1</Data><Data Name="dport">9</Data></EventData></Event>
<Event xmlns="x"><System><EventID>43</EventID></System><EventData><Data Name="PID">2100</Data><Data Name="daddr">10.0.0.5</Data><Data Name="dport">60000</Data></EventData></Event>
<Event xmlns="x"><System><EventID>10</EventID></System><EventData><Data Name="PID">3000</Data><Data Name="daddr">127.0.0.1</Data><Data Name="dport">41234</Data></EventData></Event>
<Event xmlns="x"><System><EventID>58</EventID></System><EventData><Data Name="PID">3001</Data><Data Name="daddr">2001:4860:4860::8888</Data><Data Name="dport">443</Data></EventData></Event>
<Event xmlns="x"><System><EventID>42</EventID></System><EventData><Data Name="PID">1500</Data><Data Name="daddr">8.8.8.8</Data><Data Name="dport">53</Data></EventData></Event>
</Events>`;

test("the macOS runner's own lines: no direction, so a packet to this computer came in", () => {
  // As tcpdump printed these on the macOS runner, in the control's run.
  const lines = `09:28:08.044881 (proc Runner.Worker:18872, eproc Runner.Worker:18872) IP 140.82.112.21.443 > 192.168.64.13.49168: Flags [.], ack 2516846193, win 138
09:28:08.103407 (proc Runner.Worker:18872) IP 192.168.64.13.49168 > 140.82.112.21.443: Flags [.], ack 282, win 2044, length 0
09:28:08.318096 (proc node:23066) IP 192.168.64.13.62650 > 192.0.2.1.9: UDP, length 1
09:28:08.321522 (proc node:23066) IP 192.168.64.13.49261 > 192.0.2.1.12: Flags [SEW], seq 1800027099, win 65535, length 0
09:28:11.594684 (proc kernel_task:0, eproc provjobd12636654:974) IP 20.75.202.224.443 > 192.168.64.13.49183: Flags [P.], seq 39:63, ack 26, win 76`;
  const local = new Set(["192.168.64.13"]);
  assert.deepEqual(macPackets(lines, local).map(({ pid, name, address, port }) => [pid, name, address, port]), [
    [18872, "Runner.Worker", "140.82.112.21", 443],
    [23066, "node", "192.0.2.1", 9],
    [23066, "node", "192.0.2.1", 12],
  ]);
  // A packet with no port, as for ICMP, keeps its whole address.
  assert.deepEqual(macPackets(`09:40:31.0 (proc Electron Helper:7191) IP 127.0.0.1 > 127.0.0.1: ICMP echo request
09:40:31.1 (proc Electron Helper:7191) IP 192.168.64.13 > 8.8.8.8: ICMP echo request`, local).map(({ address, port }) => [address, port]), [["127.0.0.1", null], ["8.8.8.8", null]]);
  // Without knowing this computer's address, nothing is taken for inbound.
  assert.equal(macPackets(lines).length, 5);
});

test("tracerpt's XML gives each outbound event with its process, and leaves receives out", () => {
  assert.deepEqual(windowsEvents(WINDOWS).map(({ id, pid, address, port }) => [id, pid, address, port]), [
    [12, 2100, "192.0.2.1", 12],
    [42, 2100, "192.0.2.1", 9],
    [10, 3000, "127.0.0.1", 41234],
    [58, 3001, "2001:4860:4860::8888", 443],
    [42, 1500, "8.8.8.8", 53],
  ]);
});

test("only the app's own can fail a run, and a packet of no process is reported", () => {
  const app = new Set([800, 812, 813]);
  assert.deepEqual(forbiddenOutbound(macPackets(MAC), app).map(({ pid, address }) => [pid, address]), [[812, "192.0.2.1"], [813, "2001:4860:4860::8888"]]);
  assert.deepEqual(unattributedOutbound(macPackets(MAC)).map(({ address }) => address), ["224.0.0.251"]);
  assert.deepEqual(forbiddenOutbound(windowsEvents(WINDOWS), new Set([3000, 3001])).map(({ pid }) => pid), [3001]);
  assert.deepEqual(forbiddenOutbound([{ pid: 1, address: "127.0.0.1", port: 53 }], new Set([1])).length, 1, "DNS to loopback");
  assert.deepEqual(forbiddenOutbound([{ pid: 1, address: null, port: null }], new Set([1])).length, 1, "an unreadable address");
});
