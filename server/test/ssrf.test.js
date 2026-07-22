// SSRF 防护共享模块测试
// 覆盖:normalizeIp(含 6to4 解码)、isInternalIp、isAlwaysBlockedIp、isMetadataHost
// 运行:node --test test/ssrf.test.js
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeIp,
  isInternalIp,
  isAlwaysBlockedIp,
  isMetadataHost,
  ALLOWED_LOCAL_HOSTS,
} from "../ssrf-shared.js";

// ---- normalizeIp ----

test("normalizeIp: 点分十进制 IPv4-mapped 解码", () => {
  assert.equal(normalizeIp("::ffff:169.254.169.254"), "169.254.169.254");
  assert.equal(normalizeIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(normalizeIp("::FFFF:10.0.0.1"), "10.0.0.1"); // 大小写不敏感
});

test("normalizeIp: 十六进制 IPv4-mapped 解码", () => {
  // ::ffff:a9fe:a9fe → 169.254.169.254 (a9fe = 43518, 高字节 0xa9=169, 低字节 0xfe=254)
  assert.equal(normalizeIp("::ffff:a9fe:a9fe"), "169.254.169.254");
  assert.equal(normalizeIp("::ffff:7f00:1"), "127.0.0.1");
});

test("normalizeIp: 十六进制 IPv4-compatible 解码", () => {
  // ::a9fe:a9fe → 169.254.169.254 (无 ffff 前缀)
  assert.equal(normalizeIp("::a9fe:a9fe"), "169.254.169.254");
  assert.equal(normalizeIp("::7f00:1"), "127.0.0.1");
});

test("normalizeIp: 6to4 地址解码 (2002:xxxx:xxxx::)", () => {
  // 2002:a9fe:a9fe:: → 169.254.169.254 (元数据 IP)
  assert.equal(normalizeIp("2002:a9fe:a9fe::"), "169.254.169.254");
  // 2002:7f00:1:: → 127.0.0.1 (环回)
  assert.equal(normalizeIp("2002:7f00:0001::"), "127.0.0.1");
  // 2002:0808:0808:: → 8.8.8.8 (公网,应放行)
  assert.equal(normalizeIp("2002:0808:0808::"), "8.8.8.8");
  // 2002:0:0:: → 0.0.0.0 (本网络)
  assert.equal(normalizeIp("2002:0:0::"), "0.0.0.0");
  // 大小写不敏感
  assert.equal(normalizeIp("2002:A9FE:A9FE::"), "169.254.169.254");
});

test("normalizeIp: 普通 IPv6 原样返回", () => {
  assert.equal(normalizeIp("::1"), "::1");
  assert.equal(normalizeIp("fe80::1"), "fe80::1");
  assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
  assert.equal(normalizeIp("fc00::1"), "fc00::1");
});

test("normalizeIp: 非 IPv4-mapped 的 2002 地址原样返回", () => {
  // 2002:db8:: 不是 6to4 包装内网 IP(db8 是文档段,非内网),但格式匹配 6to4
  // 实际 2002:db8:0000:: → 13.184.0.0 (公网),会被解码
  assert.equal(normalizeIp("2002:0db8:0000::"), "13.184.0.0");
});

test("normalizeIp: 边界输入", () => {
  assert.equal(normalizeIp(""), "");
  assert.equal(normalizeIp(null), "");
  assert.equal(normalizeIp(undefined), "");
  assert.equal(normalizeIp(12345), "");
});

// ---- isInternalIp ----

test("isInternalIp: RFC 1918 私有段", () => {
  assert.ok(isInternalIp("10.0.0.1"));
  assert.ok(isInternalIp("10.255.255.255"));
  assert.ok(isInternalIp("192.168.1.1"));
  assert.ok(isInternalIp("172.16.0.1"));
  assert.ok(isInternalIp("172.31.255.255"));
  assert.ok(isInternalIp("172.32.0.1") === false); // 172.32 不在私有段
});

test("isInternalIp: 环回地址", () => {
  assert.ok(isInternalIp("127.0.0.1"));
  assert.ok(isInternalIp("127.255.255.255"));
  assert.ok(isInternalIp("::1"));
});

test("isInternalIp: CGNAT 100.64.0.0/10", () => {
  assert.ok(isInternalIp("100.64.0.1"));
  assert.ok(isInternalIp("100.127.255.255"));
  assert.ok(isInternalIp("100.63.0.1") === false); // 100.63 不在 CGNAT
  assert.ok(isInternalIp("100.128.0.1") === false); // 100.128 不在 CGNAT
});

test("isInternalIp: 链路本地 169.254.0.0/16", () => {
  assert.ok(isInternalIp("169.254.169.254")); // AWS 元数据
  assert.ok(isInternalIp("169.254.0.1"));
});

test("isInternalIp: 0.0.0.0/8 本网络", () => {
  assert.ok(isInternalIp("0.0.0.0"));
  assert.ok(isInternalIp("0.255.255.255"));
});

test("isInternalIp: 多播 224.0.0.0/4 + 保留 240.0.0.0/4", () => {
  assert.ok(isInternalIp("224.0.0.1"));
  assert.ok(isInternalIp("239.255.255.255"));
  assert.ok(isInternalIp("240.0.0.1"));
  assert.ok(isInternalIp("255.255.255.255")); // 广播
});

test("isInternalIp: TEST-NET + 基准测试段", () => {
  assert.ok(isInternalIp("192.0.2.1"));  // TEST-NET-1
  assert.ok(isInternalIp("198.18.0.1")); // 基准测试
  assert.ok(isInternalIp("198.51.100.1")); // TEST-NET-2
  assert.ok(isInternalIp("203.0.113.1")); // TEST-NET-3
});

test("isInternalIp: IPv6 内网段", () => {
  assert.ok(isInternalIp("fe80::1"));    // 链路本地
  assert.ok(isInternalIp("febf::1"));    // 链路本地上界
  assert.ok(isInternalIp("fc00::1"));    // ULA
  assert.ok(isInternalIp("fdff::1"));    // ULA 上界
  assert.ok(isInternalIp("ff00::1"));    // 多播
  assert.ok(isInternalIp("2001:db8::1")); // 文档段
  assert.ok(isInternalIp("100::"));       // discard 前缀
});

test("isInternalIp: 公网 IP 不被误判", () => {
  assert.ok(isInternalIp("8.8.8.8") === false);
  assert.ok(isInternalIp("1.1.1.1") === false);
  assert.ok(isInternalIp("172.32.0.1") === false);
  assert.ok(isInternalIp("11.0.0.1") === false);
});

test("isInternalIp: IPv4-mapped IPv6 解码后正确判定", () => {
  assert.ok(isInternalIp("::ffff:10.0.0.1"));
  assert.ok(isInternalIp("::ffff:169.254.169.254"));
  assert.ok(isInternalIp("::ffff:a9fe:a9fe")); // 十六进制形式
  assert.ok(isInternalIp("::ffff:8.8.8.8") === false);
});

test("isInternalIp: 6to4 包装内网 IP 被正确拦截", () => {
  assert.ok(isInternalIp("2002:a9fe:a9fe::")); // → 169.254.169.254 元数据
  assert.ok(isInternalIp("2002:7f00:1::"));    // → 127.0.0.1 环回
  assert.ok(isInternalIp("2002:0a00:1::"));    // → 10.0.0.1 RFC 1918
  assert.ok(isInternalIp("2002:0:0::"));        // → 0.0.0.0 本网络
  // 6to4 包装公网 IP 不被拦截
  assert.ok(isInternalIp("2002:0808:0808::") === false); // → 8.8.8.8
});

// ---- isAlwaysBlockedIp ----

test("isAlwaysBlockedIp: 链路本地 IPv4(含元数据)", () => {
  assert.ok(isAlwaysBlockedIp("169.254.169.254"));
  assert.ok(isAlwaysBlockedIp("169.254.0.1"));
});

test("isAlwaysBlockedIp: 链路本地 IPv6 fe80::/10", () => {
  assert.ok(isAlwaysBlockedIp("fe80::1"));
  assert.ok(isAlwaysBlockedIp("febf::1"));
});

test("isAlwaysBlockedIp: ULA IPv6 fc00::/7", () => {
  assert.ok(isAlwaysBlockedIp("fc00::1"));
  assert.ok(isAlwaysBlockedIp("fd00::1"));
  assert.ok(isAlwaysBlockedIp("fdff::1"));
});

test("isAlwaysBlockedIp: 非阻断 IP", () => {
  assert.ok(isAlwaysBlockedIp("127.0.0.1") === false); // 环回不在 ALWAYS_BLOCKED
  assert.ok(isAlwaysBlockedIp("10.0.0.1") === false);  // RFC 1918 不在 ALWAYS_BLOCKED
  assert.ok(isAlwaysBlockedIp("8.8.8.8") === false);
});

test("isAlwaysBlockedIp: IPv4-mapped + 6to4 解码后正确判定", () => {
  assert.ok(isAlwaysBlockedIp("::ffff:169.254.169.254"));
  assert.ok(isAlwaysBlockedIp("::ffff:a9fe:a9fe"));
  assert.ok(isAlwaysBlockedIp("2002:a9fe:a9fe::")); // 6to4 → 169.254.169.254
});

// ---- isMetadataHost ----

test("isMetadataHost: 云元数据 hostname", () => {
  assert.ok(isMetadataHost("metadata.google.internal")); // GCP
  assert.ok(isMetadataHost("169.254.169.254"));          // AWS/Azure IP 字面量
  assert.ok(isMetadataHost("metadata"));                  // 简写
  assert.ok(isMetadataHost("metadata.aws.internal"));
});

test("isMetadataHost: .internal 后缀(不含 host.docker.internal)", () => {
  assert.ok(isMetadataHost("evil.internal"));
  assert.ok(isMetadataHost("foo.internal"));
  // host.docker.internal 不应被阻断(内置 Ollama provider 需要)
  assert.ok(isMetadataHost("host.docker.internal") === false);
});

test("isMetadataHost: 正常 hostname 不被误判", () => {
  assert.ok(isMetadataHost("api.deepseek.com") === false);
  assert.ok(isMetadataHost("api.openai.com") === false);
  assert.ok(isMetadataHost("localhost") === false);
  assert.ok(isMetadataHost("") === false);
  assert.ok(isMetadataHost(null) === false);
});

// ---- ALLOWED_LOCAL_HOSTS ----

test("ALLOWED_LOCAL_HOSTS: 包含本机地址", () => {
  assert.ok(ALLOWED_LOCAL_HOSTS.has("localhost"));
  assert.ok(ALLOWED_LOCAL_HOSTS.has("127.0.0.1"));
  assert.ok(ALLOWED_LOCAL_HOSTS.has("0.0.0.0"));
  assert.ok(ALLOWED_LOCAL_HOSTS.has("::1"));
  // host.docker.internal 不在允许列表(应用 custom 分类)
  assert.ok(ALLOWED_LOCAL_HOSTS.has("host.docker.internal") === false);
});
