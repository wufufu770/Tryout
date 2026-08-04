// 语音闭环端到端冒烟测试(CI 用)
// 验证: 建会话 → transcribe(降级) → scoreAnswer(LLM mock) → question_feedback 入库 → predictQuestions
// 前置: 服务端已启动(PORT 环境变量或 3001),DB 可写
import http from "node:http";

const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const TOKEN = process.env.API_TOKEN || "";

function req(method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const h = {
      "Content-Type": "application/json",
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...headers,
      ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
    };
    const r = http.request(`${BASE}${path}`, { method, headers: h }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}

// ---- mock LLM:固定返回可解析 JSON ----
const mockLLM = http.createServer((req, res) => {
  let buf = "";
  req.on("data", (c) => (buf += c));
  req.on("end", () => {
    let content = "";
    try {
      const body = JSON.parse(buf);
      const userMsg = (body.messages || []).filter((m) => m.role === "user").map((m) => m.content).join("\n");
      if (userMsg.includes("资深面试官视角")) {
        content = JSON.stringify({
          score: 7.5,
          starAnalysis: { situation: "ok", task: "ok", action: "ok", result: "ok" },
          weaknessTags: ["缺乏量化结果", "逻辑跳跃"],
          improvement: "用 STAR 结构,补充量化指标",
          betterAnswer: "在……项目中,我负责……,通过……使性能提升 30%",
        });
      } else if (userMsg.includes("押题")) {
        content = JSON.stringify([
          { question: "介绍你最有挑战的一个项目", category: "项目", difficulty: 3, intent: "考察项目深度", keyPoints: ["STAR", "量化"] },
          { question: "Redis 缓存穿透怎么解决", category: "技术", difficulty: 4, intent: "考察原理", keyPoints: ["布隆过滤器", "空值缓存"] },
        ]);
      } else {
        content = "ok";
      }
    } catch { content = "ok"; }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  });
});

const MOCK_PORT = 3799;
await new Promise((r) => mockLLM.listen(MOCK_PORT, "127.0.0.1", r));

try {
  console.log("[e2e] 1. 注册本地 mock provider");
  const pv = await req("POST", "/api/providers", {
    name: "E2E Mock",
    category: "local",
    baseUrl: `http://127.0.0.1:${MOCK_PORT}/v1`,
    modelName: "mock-llm",
    apiFormat: "openai_chat",
  });
  const providerId = pv.body?.data?.providerId || pv.body?.data?.id;
  check("provider 创建", !!providerId, JSON.stringify(pv.body).slice(0, 120));

  console.log("[e2e] 2. 建会话");
  const sess = await req("POST", "/api/sessions", { title: "e2e-smoke", modelId: providerId, flowTemplate: null });
  const sessionId = sess.body?.data?.sessionId;
  check("session 创建", !!sessionId);

  console.log("[e2e] 3. transcribe 降级路径(无模型)");
  const form = new FormData();
  const ogg = Buffer.from("OggS-mock-audio");
  form.append("audio", new Blob([ogg], { type: "audio/ogg" }), "a.ogg");
  form.append("sessionId", sessionId);
  form.append("question", "介绍自己");
  const tr = await fetch(`${BASE}/api/transcribe`, { method: "POST", headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}, body: form });
  const trJson = await tr.json();
  check("transcribe 返回降级错误(模型未装)", trJson?.data?.ok === false && !!trJson?.data?.error, JSON.stringify(trJson.data).slice(0, 120));

  console.log("[e2e] 4. 逐题评分(mock LLM)");
  const sc = await req("POST", `/api/sessions/${sessionId}/answers/score`, {
    provider: providerId, question: "介绍你最有挑战的项目", answer: "我在项目中负责核心模块…",
  });
  check("评分成功", sc.body?.data?.ok === true && typeof sc.body?.data?.score === "number", JSON.stringify(sc.body).slice(0, 150));
  check("评分 JSON 解析正确", sc.body?.data?.score === 7.5);

  console.log("[e2e] 5. 反馈入库 + 列表");
  const list = await req("GET", `/api/sessions/${sessionId}/answers`);
  check("question_feedback 已入库", Array.isArray(list.body?.data) && list.body.data.length === 1);
  check("weaknessTags 解析", Array.isArray(list.body?.data?.[0]?.weaknessTags) && list.body.data[0].weaknessTags.length === 2);

  console.log("[e2e] 6. 错题标记 + 删除");
  const fid = list.body?.data?.[0]?.feedbackId;
  const mk = await req("PUT", `/api/answers/${fid}/missed`, { isMissed: true });
  check("错题标记", mk.body?.ok === true);
  const dl = await req("DELETE", `/api/answers/${fid}`);
  check("删除反馈", dl.body?.ok === true);

  console.log("[e2e] 7. 简历押题(mock LLM)");
  const pq = await req("POST", "/api/analysis/predict-questions", {
    provider: providerId, resumeText: "5 年后端经验,精通 Redis/MySQL,主导过秒杀系统",
  });
  check("押题成功", pq.body?.data?.ok === true && Array.isArray(pq.body?.data?.questions), JSON.stringify(pq.body).slice(0, 150));
  check("押题数量", pq.body?.data?.questions?.length === 2);

  console.log("[e2e] 8. 清理 provider");
  const rm = await req("DELETE", `/api/providers/${providerId}`);
  check("provider 清理", rm.body?.ok === true);
} finally {
  mockLLM.close();
}

console.log(`\n[e2e] 结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
