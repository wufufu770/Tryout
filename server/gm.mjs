import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os";
const PORT=3461, DB=fs.mkdtempSync(path.join(os.tmpdir(),"gm-")), BASE=`http://127.0.0.1:${PORT}`;
const c=spawn("node",["index.js"],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),DB_DIR:DB,NODE_ENV:"test"},stdio:"ignore"});
process.on("exit",()=>{try{c.kill("SIGKILL");fs.rmSync(DB,{recursive:true,force:true})}catch{}});
for(let i=0;i<40;i++){try{if((await fetch(`${BASE}/api/health`)).ok)break}catch{}await new Promise(r=>setTimeout(r,300))}
const T=fs.readFileSync(path.join(DB,".api_token"),"utf8").trim();
const H={"Content-Type":"application/json",Authorization:`Bearer ${T}`};
for (const [label, body] of [
  ["空对象 {}", {}],
  ["合法结构+不存在的 provider", { provider: "prov_does_not_exist", messages:[{role:"user",content:"hi"}] }],
]) {
  const r=await fetch(`${BASE}/api/chat`,{method:"POST",headers:H,body:JSON.stringify(body)});
  const j=await r.json().catch(()=>null);
  console.log(`  ${label.padEnd(30)} → HTTP ${r.status}  code=${j?.code}`);
}
