import { spawn } from "node:child_process"; import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import http from "node:http";
const PORT=3463, DB=fs.mkdtempSync(path.join(os.tmpdir(),"leak-")), BASE=`http://127.0.0.1:${PORT}`;
const PHONE="13800001234", EMAIL="leakprobe@example.com";
// 上游恒返 500 —— 目的就是走到 llm.js 的 !resp.ok 分支
const up=http.createServer((q,s)=>{q.resume();s.writeHead(500,{"Content-Type":"application/json"});s.end(JSON.stringify({error:{message:"upstream boom"}}))});
await new Promise(r=>up.listen(0,"127.0.0.1",r)); const UP=up.address().port;
let log="";
const c=spawn("node",["index.js"],{cwd:process.cwd(),env:{...process.env,PORT:String(PORT),DB_DIR:DB,NODE_ENV:"test"},stdio:["ignore","pipe","pipe"]});
c.stdout.on("data",d=>log+=d); c.stderr.on("data",d=>log+=d);
process.on("exit",()=>{try{c.kill("SIGKILL");up.close();fs.rmSync(DB,{recursive:true,force:true})}catch{}});
for(let i=0;i<50;i++){try{if((await fetch(`${BASE}/api/health`)).ok)break}catch{}await new Promise(r=>setTimeout(r,300))}
const T=fs.readFileSync(path.join(DB,".api_token"),"utf8").trim();
const H={"Content-Type":"application/json",Authorization:`Bearer ${T}`};
const p=await (await fetch(`${BASE}/api/providers`,{method:"POST",headers:H,body:JSON.stringify({name:"LEAK-PROBE",category:"local",baseUrl:`http://127.0.0.1:${UP}/v1`,apiFormat:"openai_chat"})})).json();
await fetch(`${BASE}/api/chat`,{method:"POST",headers:H,body:JSON.stringify({provider:p.data.providerId,messages:[{role:"user",content:`我的手机号是 ${PHONE},邮箱 ${EMAIL}`}],stream:false})});
await new Promise(r=>setTimeout(r,900));
console.log("=== 上游恒返 500 后的服务端日志判定 ===");
console.log("  明文手机号出现在日志:", log.includes(PHONE) ? "❗ 是 —— PII 泄露" : "否 ✅");
console.log("  明文邮箱出现在日志  :", log.includes(EMAIL) ? "❗ 是 —— PII 泄露" : "否 ✅");
const m=log.split("\n").find(l=>l.includes("upstream.error"));
if(m){ try{ const o=JSON.parse(m); console.log("  llm.upstream.error 字段:", Object.keys(o).join(", ")); }catch{ console.log("  原始行:", m.slice(0,150)); } }
