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

test("a real trace: a connected UDP socket keeps its local name, and its send answers to its peer", () => {
  // As strace -yy printed these on the Linux runner, from the trap's own control.
  const attempts = networkAttempts(`3029 connect(20<UDP:[0.0.0.0:58172]>, {sa_family=AF_INET, sin_port=htons(10), sin_addr=inet_addr("192.0.2.1")}, 16) = 0
3029 sendmsg(20<UDP:[0.0.0.0:54670]>, {msg_name={sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("192.0.2.1")}, msg_namelen=16, msg_iov=[{iov_base="x", iov_len=1}], msg_iovlen=1, msg_controll
3029 connect(20<UDP:[0.0.0.0:52905]>, {sa_family=AF_INET, sin_port=htons(11), sin_addr=inet_addr("192.0.2.1")}, 16) = 0
3029 sendmsg(20<UDP:[0.0.0.0:52905]>, {msg_name=NULL, msg_namelen=0, msg_iov=[{iov_base="x", iov_len=1}], msg_iovlen=1, msg_controllen=0, msg_flags=0}, 0) = 1
3029 connect(21<TCP:[16218]>, {sa_family=AF_INET, sin_port=htons(12), sin_addr=inet_addr("192.0.2.1")}, 16) = -1 EINPROGRESS (Operation now in progress)`);
  assert.deepEqual(forbiddenAttempts(attempts).map(({ call, port }) => [call, port]), [["sendmsg", 9], ["sendmsg", 11], ["connect", 12]]);
  assert.deepEqual(routeQueries(attempts).map(({ port }) => port), [10, 11]);
});

test("where the trace names only an inode, a send answers to what that socket connected to", () => {
  const attempts = networkAttempts(`300 sendmsg(5<UDP:[777]>, {msg_name=NULL, msg_namelen=0}, 0) = 1
301 connect(5<UDP:[777]>, {sa_family=AF_INET, sin_port=htons(11), sin_addr=inet_addr("192.0.2.1")}, 16) = 0
302 connect(6<UDP:[778]>, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("8.8.8.8")}, 16) = 0
303 write(7<UDP:[779]>, "x", 1) = 1
304 connect(8<socket:[780]>, {sa_family=AF_INET, sin_port=htons(443), sin_addr=inet_addr("8.8.4.4")}, 16) = 0
305 write(8<socket:[780]>, "x", 1) = 1
306 connect(9<TCP:[781]>, {sa_family=AF_INET, sin_port=htons(1234), sin_addr=inet_addr("127.0.0.1")}, 16) = 0
307 write(9<TCP:[781]>, "x", 1) = 1
308 write(9<TCP:[900]>, "x", 1) = 1`);
  // Another thread's send, before its connect in the trace, is held against that peer.
  assert.deepEqual(forbiddenAttempts(attempts).map(({ pid, port }) => [pid, port]), [[300, 11], [303, null], [304, 443], [305, 443]]);
  // The route query alone stays a route query, and a TCP socket never connected is one this
  // computer accepted. Loopback traffic stays allowed.
  assert.deepEqual(routeQueries(attempts).map(({ pid }) => pid), [301, 302]);
  assert.equal(attempts.some(({ pid }) => pid === 308), false);
  assert.deepEqual(attempts.filter(({ pid }) => pid === 307).map(({ address }) => address), ["127.0.0.1"]);
});

test("every address in one call counts, and an unsure reading fails closed", () => {
  const forbidden = (trace) => forbiddenAttempts(networkAttempts(trace)).map(({ call, address, port }) => [call, address, port]);
  // A sendmmsg to loopback, then off this computer.
  assert.deepEqual(forbidden(`1 sendmmsg(5<UDP:[1]>, [{msg_hdr={msg_name={sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("127.0.0.1")}}}, {msg_hdr={msg_name={sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("8.8.8.8")}}}], 2, 0) = 2`), [["sendmmsg", "8.8.8.8", 9]]);
  // Connected under one name, sent under another: no peer known, so forbidden.
  assert.deepEqual(forbidden(`1 connect(5<UDP:[777]>, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("8.8.8.8")}, 16) = 0
1 sendmsg(5<UDP:[0.0.0.0:4000]>, {msg_name=NULL}, 0) = 1`), [["sendmsg", null, null]]);
  // A loopback connect, a reconnect off this computer, and a send under the old name.
  assert.deepEqual(forbidden(`1 connect(5<UDP:[0.0.0.0:4000]>, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("127.0.0.1")}, 16) = 0
1 connect(5<UDP:[127.0.0.1:4000->127.0.0.1:9]>, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("8.8.8.8")}, 16) = 0
1 write(5<UDP:[127.0.0.1:4000->127.0.0.1:9]>, "x", 1) = 1`), [["write", "8.8.8.8", 9]]);
  // By other calls: writev and sendfile on a connected socket, and splice into one.
  const connect = `1 connect(5<UDP:[0.0.0.0:4000]>, {sa_family=AF_INET, sin_port=htons(9), sin_addr=inet_addr("8.8.8.8")}, 16) = 0\n`;
  for (const [call, line] of [["writev", `1 writev(5<UDP:[0.0.0.0:4000]>, [{iov_base="x", iov_len=1}], 1) = 1`], ["sendfile", `1 sendfile(5<UDP:[0.0.0.0:4000]>, 7</tmp/f>, NULL, 1) = 1`], ["splice", `1 splice(7<pipe:[9]>, NULL, 5<UDP:[0.0.0.0:4000]>, NULL, 1, 0) = 1`]]) {
    assert.deepEqual(forbidden(connect + line), [[call, "8.8.8.8", 9]], call);
  }
  // io_uring's calls cannot be read, and a resolver over a Unix socket names no address.
  assert.deepEqual(forbidden(`1 io_uring_setup(4, {}) = 3`), [["io_uring_setup", null, null]]);
  assert.deepEqual(forbidden(`1 io_uring_setup(4, {}) <unfinished ...>`), [["io_uring_setup", null, null]]);
  assert.deepEqual(forbidden(`1 io_uring_setup(4, {}) = -1 EPERM (Operation not permitted)`), [], "no ring to send through");
  assert.deepEqual(forbidden(`1 io_uring_setup(4, {}) = -1 ENOSYS (Function not implemented)`), []);
  assert.deepEqual(forbidden(`1 connect(5<UNIX:[1]>, {sa_family=AF_UNIX, sun_path="/run/systemd/resolve/io.systemd.Resolve"}, 110) = 0`), [["connect", null, 53]]);
  assert.deepEqual(forbidden(`1 connect(5<UNIX:[1]>, {sa_family=AF_UNIX, sun_path="/run/systemd/resolve/io.systemd.Resolve"}, 110) = -1 ENOENT (No such file or directory)`), []);
  // A write to a file, a pipe, or a descriptor with no name is no attempt.
  assert.deepEqual(forbidden(`1 write(20</tmp/file>, "x", 1) = 1\n1 write(1, "x", 1) = 1\n1 writev(4<pipe:[1]>, [], 0) = 0\n1 splice(7<pipe:[9]>, NULL, 8<pipe:[10]>, NULL, 1, 0) = 1`), []);
});
