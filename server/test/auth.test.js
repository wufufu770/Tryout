// Auth 认证中间件测试
import test from "node:test";
import assert from "node:assert/strict";

test("isAuthEnabled 在 INTERVIEWX_AUTH_DISABLED=1 时返回 false", async () => {
  // 动态设置环境变量后重新 import
  process.env.INTERVIEWX_AUTH_DISABLED = "1";
  // 清除模块缓存(动态 import 会再次执行)
  const mod = await import(`../auth.js?t=${Date.now()}`);
  assert.equal(mod.isAuthEnabled(), false);
});

test("isAuthEnabled 在有 token 时返回 true", async () => {
  delete process.env.INTERVIEWX_AUTH_DISABLED;
  process.env.INTERVIEWX_API_TOKEN = "test-token-12345";
  const mod = await import(`../auth.js?t=${Date.now() + 1}`);
  assert.equal(mod.isAuthEnabled(), true);
});

test("authMiddleware 在禁用模式下直接放行", async () => {
  process.env.INTERVIEWX_AUTH_DISABLED = "1";
  const mod = await import(`../auth.js?t=${Date.now() + 2}`);
  let called = false;
  const fakeReq = { path: "/api/agents" };
  const fakeRes = {};
  mod.authMiddleware(fakeReq, fakeRes, () => { called = true; });
  assert.ok(called);
});

test("authMiddleware 缺失 Authorization 返回 401", async () => {
  delete process.env.INTERVIEWX_AUTH_DISABLED;
  process.env.INTERVIEWX_API_TOKEN = "secret";
  const mod = await import(`../auth.js?t=${Date.now() + 3}`);
  let statusCode = null;
  let body = null;
  const fakeReq = { path: "/api/agents", headers: {} };
  const fakeRes = {
    status(s) { statusCode = s; return this; },
    json(b) { body = b; return this; },
  };
  mod.authMiddleware(fakeReq, fakeRes, () => {});
  assert.equal(statusCode, 401);
  assert.equal(body.code, "AUTH_MISSING");
});

test("authMiddleware 错误 token 返回 401", async () => {
  delete process.env.INTERVIEWX_AUTH_DISABLED;
  process.env.INTERVIEWX_API_TOKEN = "correct-token";
  const mod = await import(`../auth.js?t=${Date.now() + 4}`);
  let statusCode = null;
  const fakeReq = {
    path: "/api/agents",
    headers: { authorization: "Bearer wrong-token" },
  };
  const fakeRes = {
    status(s) { statusCode = s; return this; },
    json() { return this; },
  };
  mod.authMiddleware(fakeReq, fakeRes, () => {});
  assert.equal(statusCode, 401);
});

test("authMiddleware 正确 token 放行", async () => {
  delete process.env.INTERVIEWX_AUTH_DISABLED;
  process.env.INTERVIEWX_API_TOKEN = "correct-token";
  const mod = await import(`../auth.js?t=${Date.now() + 5}`);
  let called = false;
  const fakeReq = {
    path: "/api/agents",
    headers: { authorization: "Bearer correct-token" },
  };
  mod.authMiddleware(fakeReq, {}, () => { called = true; });
  assert.ok(called);
});

test("authMiddleware 健康检查路径豁免", async () => {
  delete process.env.INTERVIEWX_AUTH_DISABLED;
  process.env.INTERVIEWX_API_TOKEN = "secret";
  const mod = await import(`../auth.js?t=${Date.now() + 6}`);
  let called = false;
  const fakeReq = { path: "/api/health", headers: {} };
  mod.authMiddleware(fakeReq, {}, () => { called = true; });
  assert.ok(called);
});

test("authMiddleware 支持多 token", async () => {
  delete process.env.INTERVIEWX_AUTH_DISABLED;
  process.env.INTERVIEWX_API_TOKEN = "token-a,token-b,token-c";
  const mod = await import(`../auth.js?t=${Date.now() + 7}`);
  for (const t of ["token-a", "token-b", "token-c"]) {
    let called = false;
    const fakeReq = {
      path: "/api/x",
      headers: { authorization: `Bearer ${t}` },
    };
    mod.authMiddleware(fakeReq, {}, () => { called = true; });
    assert.ok(called, `token ${t} 应通过`);
  }
});
