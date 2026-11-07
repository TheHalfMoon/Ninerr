import test from "node:test";
import assert from "node:assert/strict";

import { forbiddenAttempts, isLoopback, networkAttempts, routeQueries } from "../scripts/desktop/egress.mjs";

// R04: reading a whole-process trace. What strace prints is taken from its own format, with -yy.
const TRACE = `
100 connect(22<TCP:[5001]>, {sa_family=AF_INET, sin_port=htons(41234), sin_addr=inet_addr("127.0.0.1")}, 16) = 0
101 connect(30<TCPv6:[5002]>, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2606:4700::1", &sin6_addr), sin6_scope_id=0}, 28 <unfinished ...>
102 connect(31<TCP:[5003]>, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("93.184.216.34")}, 16) = -1 EINPROGRESS (Operation now in progress)
103 connect(9<UNIX:[5004]>, {sa_family=AF_UNIX, sun_path="/run/user/1000/bus"}, 110) = 0
104 sendto(7<NETLINK:[5005]>, "x", 1, 0, {sa_family=AF_NETLINK, nl_pid=0, nl_groups=00000000}, 12) = 1
105 sendto(8<UNIX:[5006->5007]>, "x", 1, MSG_NOSIGNAL, NULL, 0) = 1
106 sendmsg(12<UDP:[5008]>, {msg_name={sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, msg_namelen=16}, 0) = 30
107 sendto(13<UDP:[5009]>, "q", 1, 0, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("192.0.2.1")}, 16) = 1
108 connect(14<TCPv6:[5010]>, {sa_family=AF_INET6, sin6_port=htons(80), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "::1", &sin6_addr), sin6_scope_id=0}, 28) = 0
109 connect(15, {sa_family=AF_INET, sin_port=htons(80), sin_addr=not_readable}, 16) = 0
110 connect(16<UDPv6:[5011]>, {sa_family=AF_INET6, sin6_port=htons(443), sin6_flowinfo=htonl(0), inet_pton(AF_INET6, "2001:4860:4860::8888", &sin6_addr), sin6_scope_id=0}, 28) = 0
111 write(17<UDPv6:[[2001:db8::1]:4000->[2001:4860:4860::8888]:443]>, "x", 1) = 1
112 sendmsg(18<UDP:[10.0.0.2:4000->8.8.8.8:443]>, {msg_name=NULL, msg_namelen=0}, 0) = 1
113 write(19<TCP:[127.0.0.1:50000->127.0.0.1:41234]>, "x", 1) = 1
114 write(20</tmp/file>, "x", 1) = 1
115 write(1, "x", 1) = 1
116 connect(21<UDP:[5012]>, {sa_family=AF_INET, sin_port=htons(53), sin_addr=inet_addr("127.0.0.53")}, 16) = 0
117 +++ exited with 0 +++
`;

test("a trace gives every internet address tried, by any call, and nothing else", () => {
  assert.deepEqual(networkAttempts(TRACE).map(({ pid, call, transport, address, port }) => [pid, call, transport, address, port]), [
    [100, "connect", "TCP", "127.0.0.1", 41234],
    [101, "connect", "TCP", "2606:4700::1", 443],
    [102, "connect", "TCP", "93.184.216.34", 443],
    [106, "sendmsg", "UDP", "127.0.0.53", 53],
    [107, "sendto", "UDP", "192.0.2.1", 9],
    [108, "connect", "TCP", "::1", 80],
    [109, "connect", null, null, 80],
    [110, "connect", "UDP", "2001:4860:4860::8888", 443],
    [111, "write", "UDP", "2001:4860:4860::8888", 443],
    [112, "sendmsg", "UDP", "8.8.8.8", 443],
    [113, "write", "TCP", "127.0.0.1", 41234],
    [116, "connect", "UDP", "127.0.0.53", 53],
  ]);
  assert.deepEqual(networkAttempts(""), []);
});

test("loopback is this computer's own addresses only", () => {
  for (const address of ["127.0.0.1", "127.255.255.254", "::1", "::ffff:127.0.0.1"]) assert.equal(isLoopback(address), true, address);
  for (const address of ["128.0.0.1", "0.0.0.0", "::", "::ffff:8.8.8.8", "fe80::1", "127.0.0.1.example.com", null]) assert.equal(isLoopback(address), false, String(address));
});

test("a UDP connect sends nothing and is reported; what sends off this computer is forbidden", () => {
  const attempts = networkAttempts(TRACE);
  assert.deepEqual(forbiddenAttempts(attempts).map(({ pid }) => pid), [101, 102, 106, 107, 109, 111, 112], "TCP off it, any send off it, DNS, an unreadable address");
  assert.deepEqual(routeQueries(attempts).map(({ pid }) => pid), [110]);
  assert.deepEqual(forbiddenAttempts([{ call: "connect", transport: "TCP", address: "127.0.0.1", port: 8080 }]), []);
  // A connect on a socket the trace did not name is not taken for a route query.
  assert.equal(forbiddenAttempts([{ call: "connect", transport: null, address: "8.8.8.8", port: 443 }]).length, 1);
  // Nor a route query's peer, once anything is sent to it.
  const probe = networkAttempts(`200 connect(5<UDP:[1]>, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("8.8.8.8")}, 16) = 0
200 write(5<UDP:[10.0.0.2:1->8.8.8.8:443]>, "x", 1) = 1`);
  assert.deepEqual(forbiddenAttempts(probe).map(({ call }) => call), ["write"]);
});
