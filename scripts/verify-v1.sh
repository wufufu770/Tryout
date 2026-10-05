#!/usr/bin/env bash
# V1 端到端:真实 HTTP 上传 → PDF 解析 → 结构化字段
# 比打包测试更接近真实使用路径
set -uo pipefail
PORT=3471
DB=/tmp/v1-e2e
rm -rf "$DB"

cd /workspace/Tryout/server
DB_DIR="$DB" INTERVIEWX_AUTH_DISABLED=1 PORT=$PORT node index.js >/tmp/v1-srv.log 2>&1 &
PID=$!
for i in $(seq 1 120); do
  curl -s --max-time 1 "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done

cd /workspace/Tryout/web
cat > /tmp/pr-e2e.mjs <<'EOF'
import fs from "node:fs"; import path from "node:path"; import os from "node:os";
import { execFileSync } from "node:child_process";
const WEB = "/workspace/Tryout/web";
const T = fs.mkdtempSync(path.join(os.tmpdir(), "pr-"));
const E = path.join(T, "e.mjs");
fs.writeFileSync(E, `export { parseResume } from "${WEB}/src/lib/resumeParser.ts";`);
const B = path.join(T, "b.mjs");
execFileSync(path.join(WEB, "node_modules/esbuild/bin/esbuild"),
  [E, "--bundle", "--format=esm", "--platform=node", `--outfile=${B}`, "--log-level=error"],
  { cwd: WEB, stdio: "pipe" });
const { parseResume } = await import(B);

const PORT = process.env.V1_PORT;
console.log("=== V1 端到端: 上传 PDF → 解析 → 结构化 ===\n");
let pass = 0, fail = 0;
for (const f of ["resume1", "resume2_typst_zh", "resume3_typst_zh_v2"]) {
  const buf = fs.readFileSync(`/workspace/resume-test/${f}.pdf`);
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: "application/pdf" }), `${f}.pdf`);
  fd.append("type", "resume");
  const r = await fetch(`http://127.0.0.1:${PORT}/api/materials/upload`, { method: "POST", body: fd });
  if (!r.ok) { console.log(`  ❌ ${f}: HTTP ${r.status} ${(await r.text()).slice(0,80)}`); fail++; continue; }
  const j = await r.json();
  const text = j?.data?.rawText || "";
  const cjk = (text.match(/[一-龥]/g) || []).length;
  if (cjk < 100) { console.log(`  ❌ ${f}: 提取失败(中文字=${cjk})`); fail++; continue; }
  const p = parseResume(text);
  console.log(`  ✅ ${f}.pdf  中文字=${cjk}  长度=${text.length}`);
  console.log(`     姓名=${p.name || "—"}  电话=${p.phone || "—"}  邮箱=${p.email || "—"}`);
  console.log(`     教育=${p.education.length}条  经历=${p.experience.length}条  技能=${p.skills.length}项`);
  if (p.skills.length) console.log(`     技能样例: ${p.skills.slice(0, 5).join("、")}`);
  if (p.skills.length || p.education.length || p.experience.length) pass++; else fail++;
  console.log("");
}
console.log(`结果:${pass} 通过 / ${fail} 失败`);
fs.rmSync(T, { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);
EOF
V1_PORT=$PORT timeout 300 node /tmp/pr-e2e.mjs
rc=$?
kill -9 $PID 2>/dev/null
rm -rf "$DB"
exit $rc
