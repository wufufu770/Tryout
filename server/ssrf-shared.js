// SSRF 防护共享模块
// 设计原则(第一性原理):
//   1. 出站请求只允许连接到"被授权的目标 IP"
//   2. 所有 IP 校验必须基于真实解析的 IP(含 IPv4-mapped IPv6)
//   3. 错误处理必须基于错误类型(instanceof),不依赖文案匹配(防文案改动导致防护失效)
//   4. 错误消息不泄露服务器内部 DNS 解析结果(日志层保留完整,address 不返回客户端)
//   5. 共享常量集中一处,避免跨文件命名漂移
//
// 复用方:llm.js(assertSafeUrlAtFetch)、index.js(checkUrlSafe / validateBaseUrlSync)
// 不直接 export 异步校验函数,各自保留独立实现(因为二者错误类型不同:ValidationError vs SsrfBlockedError)

// ---- 自定义错误类(替代字符串匹配) ----
// llm.js 中 assertSafeUrlAtFetch 抛出此类型;catch 用 instanceof 判断,不依赖 message 文案
export class SsrfBlockedError extends Error {
  constructor(message, { code, host, address } = {}) {
    super(message);
    this.name = "SsrfBlockedError";
    this.ssrfCode = code;     // 稳定错误码(如 SSRF_METADATA_IP),供上层透传
    this.ssrfHost = host;     // 用户提交的 hostname(可返回客户端)
    this.ssrfAddress = address; // 服务器 DNS 解析结果(仅日志,不返回客户端)
  }
}

// ---- 稳定 SSRF 错误码(透传到前端,用于 i18n 映射) ----
export const SsrfCodes = {
  METADATA_HOST: "SSRF_METADATA_HOST",         // hostname 命中元数据黑名单(如 169.254.169.254)
  METADATA_IP: "SSRF_METADATA_IP",             // 解析到元数据 IP(链路本地 169.254.x.x)
  LOCAL_NON_LOOPBACK: "SSRF_LOCAL_NON_LOOPBACK", // local provider 解析到非本机 IP
  INTERNAL_IP: "SSRF_INTERNAL_IP",             // 非 local provider 解析到内网 IP
  UNRESOLVED: "SSRF_UNRESOLVED",               // DNS 解析失败(非 local 场景)
  REDIRECT_BLOCKED: "SSRF_REDIRECT_BLOCKED",   // 3xx 重定向被阻止(redirect: manual)
  URL_INVALID: "SSRF_URL_INVALID",             // URL 格式无效(llm.js assertSafeUrlAtFetch 抛出)
  PROTOCOL_INVALID: "SSRF_PROTOCOL_INVALID",   // 协议非 http/https(llm.js assertSafeUrlAtFetch 抛出)
};

// v10.2.1:i18n key 预映射表(替代 toCamelCase 大小写 bug)
// 直接给出每个 ssrfCode 对应的稳定 i18n key,避免字符串转换首字母大小写问题
export const SSRF_I18N_KEY_MAP = {
  [SsrfCodes.METADATA_HOST]: "error.ssrf.metadataHost",
  [SsrfCodes.METADATA_IP]: "error.ssrf.metadataIp",
  [SsrfCodes.LOCAL_NON_LOOPBACK]: "error.ssrf.localNonLoopback",
  [SsrfCodes.INTERNAL_IP]: "error.ssrf.internalIp",
  [SsrfCodes.UNRESOLVED]: "error.ssrf.unresolved",
  [SsrfCodes.REDIRECT_BLOCKED]: "error.ssrf.redirectBlocked",
  [SsrfCodes.URL_INVALID]: "error.ssrf.urlInvalid",
  [SsrfCodes.PROTOCOL_INVALID]: "error.ssrf.protocol",
};

// ---- 共享常量 ----
// 云元数据 hostname 永远阻止(无论 allowLocal)
// 攻击场景:窃取云 IAM 凭证(AWS/GCP/Azure 元数据服务)
export const METADATA_HOST_BLOCKLIST = new Set([
  "metadata.google.internal",
  "metadata",
  "metadata.aws.internal",
  "169.254.169.254",
]);

// local provider 允许的 hostname(仅本机)
// 不允许 host.docker.internal:容器内访问宿主机元数据有风险,且用户应明确用 host.docker.internal 时改用 custom 分类
export const ALLOWED_LOCAL_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
]);

// 内网 IP 黑名单(allowLocal=false 时阻止)
// 覆盖:RFC 1918 私有段 + RFC 6598 CGNAT + 链路本地 + 环回 + ULA + 0.0.0.0/8 + 多播 + 保留段
// v10.2:追加 100.64.0.0/10 CGNAT 段
// v10.2.1:补全 IPv6 ULA(fc00::/7 = fc00::-fdff::)和链路本地(fe80::/10 = fe80::-febf::)
//         补 0.0.0.0/8、224.0.0.0/4 多播、240.0.0.0/4 保留段(默认拒绝所有非公网单播)
// v10.2.2:补 IPv6 多播 ff00::/8 + IPv4 TEST-NET/基准测试段 + IPv6 文档/discard 段
//         删除 4 条 ::ffff: 冗余规则(normalizeIp 已转点分十进制,这些规则永不命中)
export const INTERNAL_IP_PATTERNS = [
  /^127\./,                                      // 环回
  /^10\./,                                       // RFC 1918 A
  /^192\.168\./,                                 // RFC 1918 C
  /^172\.(1[6-9]|2\d|3[01])\./,                  // RFC 1918 B
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,    // RFC 6598 CGNAT
  /^169\.254\./,                                 // 链路本地(含 169.254.169.254 元数据)
  /^0\./,                                        // 0.0.0.0/8 本网络(含 0.0.0.0)
  /^(22[4-9]|23\d)\./,                           // 224.0.0.0/4 多播
  /^(24\d|25[0-5])\./,                           // 240.0.0.0/4 保留段(含 255.255.255.255 广播)
  /^192\.0\.[02]\./,                             // 192.0.0.0/24 IETF + 192.0.2.0/24 TEST-NET-1(不含 192.0.1.x)
  /^198\.(1[89]|51)\./,                          // 198.18.0.0/15 基准测试 + 198.51.100.0/24 TEST-NET-2
  /^203\.0\.113\./,                              // 203.0.113.0/24 TEST-NET-3
  /^::1$/,                                       // IPv6 环回
  /^fe[89ab][0-9a-f]:/i,                         // IPv6 链路本地 fe80::/10(fe80-febf)
  /^f[cd][0-9a-f]{2}:/i,                         // IPv6 ULA fc00::/7(fc00-fdff)
  /^ff[0-9a-f]{2}:/i,                            // IPv6 多播 ff00::/8
  /^2001:db8:/i,                                 // IPv6 文档段 2001:db8::/32
  /^100::/,                                      // IPv6 discard 前缀 RFC 6666
];

// 即使 allowLocal=true 也必须阻止的 IP(链路本地 + ULA)
// 攻击场景:local provider 配置成 169.254.169.254 窃取云 IAM 凭证
// v10.2.1:补全 IPv6 ULA(fc00::/7)和链路本地(fe80::/10)CIDR
export const ALWAYS_BLOCKED_IP_PATTERNS = [
  /^169\.254\./,                       // 链路本地 IPv4(含 169.254.169.254 元数据)
  /^fe[89ab][0-9a-f]:/i,              // 链路本地 IPv6 fe80::/10(fe80-febf)
  /^f[cd][0-9a-f]{2}:/i,              // ULA IPv6 fc00::/7(fc00-fdff)
];

// ---- IP 规范化 + 判断函数 ----
// v10.2:IPv4-mapped IPv6 规范化
// v10.2.1:补全十六进制形式 ::ffff:a9fe:a9fe → 169.254.169.254(原仅处理点分十进制形式)
// 攻击场景:Linux 上 dns.lookup 对 [::ffff:a9fe:a9fe] 返回 "::ffff:a9fe:a9fe",
//          旧版 normalizeIp 仅剥前缀得 "a9fe:a9fe",不匹配任何 INTERNAL_IP_PATTERNS → SSRF 绕过
export function normalizeIp(ip) {
  if (typeof ip !== "string") return "";
  // 形式 1: ::ffff:1.2.3.4(点分十进制 IPv4-mapped)→ 1.2.3.4
  const m1 = ip.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (m1) return m1[1];
  // 形式 2: ::ffff:xxxx:xxxx(十六进制 IPv4-mapped)→ 转 点分十进制
  // 例: ::ffff:a9fe:a9fe → 169.254.169.254 (a9fe=42+9*256+10*4096=43518→0xa9fe → 高字节 0xa9=169, 低字节 0xfe=254)
  const m2 = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m2) {
    const hi = parseInt(m2[1], 16);
    const lo = parseInt(m2[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // 形式 3: ::xxxx:xxxx(十六进制 IPv4-compatible,RFC 4291 已废弃但部分系统仍支持)→ 转 点分十进制
  // 例: ::a9fe:a9fe → 169.254.169.254(无 ffff 前缀,与 mapped 区分)
  // 注意:`::1` 只有一个段不匹配此正则(需两个段),不会被错误转换
  const m3 = ip.match(/^::([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m3) {
    const hi = parseInt(m3[1], 16);
    const lo = parseInt(m3[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // 形式 4:6to4 地址 2002:xxxx:xxxx::(RFC 3056,前 16 位 2002,后 32 位是 IPv4 地址)
  // 例: 2002:a9fe:a9fe:: → 169.254.169.254;2002:7f00:1:: → 127.0.0.1
  // 攻击场景:攻击者用 6to4 包装内网/元数据 IP 绕过 IPv4 规则(normalizeIp 不解码则原样返回,不匹配任何规则)
  // v10.2.5(P1-6):解码后交由现有 IPv4 规则判定;合法 6to4 公网 IPv4 仍放行
  const m4 = ip.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/i);
  if (m4) {
    const hi = parseInt(m4[1], 16);
    const lo = parseInt(m4[2], 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  // 形式 5:其他 IPv6(含非 mapped)→ 原样返回
  return ip;
}

export function isInternalIp(ip) {
  const norm = normalizeIp(ip);
  return INTERNAL_IP_PATTERNS.some(re => re.test(norm));
}

export function isAlwaysBlockedIp(ip) {
  const norm = normalizeIp(ip);
  return ALWAYS_BLOCKED_IP_PATTERNS.some(re => re.test(norm));
}

export function isMetadataHost(host) {
  if (!host) return false;
  const h = host.toLowerCase();
  if (METADATA_HOST_BLOCKLIST.has(h)) return true;
  // v10.2.2:精确排除 Docker Desktop 标准宿主机别名 host.docker.internal
  // 原宽泛 endsWith(".internal") 会误杀内置 Ollama provider(default OLLAMA_URL)
  if (h.endsWith(".internal") && h !== "host.docker.internal") return true;
  return false;
}

// ---- 通用出站 fetch 选项(防 3xx 重定向绕过) ----
// v10.2:所有出站 LLM 请求禁止自动跟随重定向
// 攻击场景:攻击者搭建 https://evil.com/v1/chat/completions 返回 302 Location: http://169.254.169.254/...
// fetch 默认 redirect:"follow" 会自动跟随,把云元数据响应作为 LLM 响应回传,绕过 assertSafeUrlAtFetch
// LLM API 不应返回 3xx,manual 模式遇到 3xx 直接按错误处理
export const NO_REDIRECT_FETCH_INIT = {
  redirect: "manual",
};
