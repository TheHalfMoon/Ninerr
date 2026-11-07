import test from "node:test";
import assert from "node:assert/strict";

import { forbiddenAttempts, isLoopback, networkAttempts } from "../scripts/desktop/egress.mjs";

// R04: reading a whole-process trace. What strace prints is taken from its own format.
const TRACE = `
100 connect(22, {sa_family=AF_INET, sin_port=htons(41234), sin_addr=inet_addr("127.0.0.1")}, 16) = 0
101 connect(30, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2606:4700::1", &sin6_addr), sin6_scope_id=0}, 28 <unfinished ...>
102 connect(31, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("93.184.216.34")}, 16) = -1 EINPROGRESS (Operation now in progress)
103 connect(9, {sa_family=AF_UNIX, sun_path="/run/user/1000/bus"}, 110) = 0
104 sendto(7, "x", 1, 0, {sa_family=AF_NETLINK, nl_pid=0, nl_groups=00000000}, 12) = 1
105 sendto(8, "x", 1, MSG_NOSIGNAL, NULL, 0) = 1
106 sendmsg(12, {msg_name={sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, msg_namelen=16}, 0) = 30
107 sendto(13, "q", 1, 0, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("192.0.2.1")}, 16) = 1
108 connect(14, {sa_family=AF_INET6, sin6_port=htons(80), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::1", &sin6_addr), sin6_scope_id=0}, 28) = 0
109 connect(15, {sa_family=AF_INET, sin_port=htons(80), sin_addr=not_readable}, 16) = 0
110 +++ exited with 0 +++
`;

test("a trace gives every internet address tried, by any call, and nothing else", () => {
  assert.deepEqual(networkAttempts(TRACE).map(({ pid, call, address, port }) => [pid, call, address, port]), [
    [100, "connect", "127.0.0.1", 41234],
    [101, "connect", "2606:4700::1", 443],
    [102, "connect", "93.184.216.34", 443],
    [106, "sendmsg", "127.0.0.53", 53],
    [107, "sendto", "192.0.2.1", 9],
    [108, "connect", "::1", 80],
    [109, "connect", null, 80],
  ]);
  assert.deepEqual(networkAttempts(""), []);
});

test("loopback is this computer's own addresses only", () => {
  for (const address of ["127.0.0.1", "127.255.255.254", "::1", "::ffff:127.0.0.1"]) assert.equal(isLoopback(address), true, address);
  for (const address of ["128.0.0.1", "0.0.0.0", "::", "::ffff:8.8.8.8", "fe80::1", "127.0.0.1.example.com", null]) assert.equal(isLoopback(address), false, String(address));
});

test("off this computer, an unreadable address and any DNS query are forbidden, and loopback is not", () => {
  assert.deepEqual(forbiddenAttempts(networkAttempts(TRACE)).map(({ pid }) => pid), [101, 102, 106, 107, 109]);
  assert.deepEqual(forbiddenAttempts([{ address: "127.0.0.1", port: 8080 }]), []);
});
