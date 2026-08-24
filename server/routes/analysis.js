// v11:分析路由 —— 语音转写 / 逐题反馈 / 简历押题
// 挂载在 /api 下(通用限流已覆盖;LLM 调用走 chatProxy 复用故障转移 + PII 脱敏 + token 记录)
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { genId } from "../db.js";
import { chatProxy } from "../llm.js";
import { transcribeAudio, estimateWPM } from "../services/whisper.js";
import {
  DB_DIR_EXPORT,
  createAnswerRecording,
  listAnswerRecordings,
  createQuestionFeedback,
  listQuestionFeedback,
  setQuestionMissed,
  deleteQuestionFeedback,
  getSession,
  getMaterialContent,
  getTodayTokenUsage,
  recordTokenUsage,
  ValidationError,
  NotFoundError,
} from "../db.js";

const router = express.Router();
const UPLOAD_DIR = path.join(DB_DIR_EXPORT, "uploads");
const DAILY_TOKEN_BUDGET = Number(process.env.DAILY_TOKEN_BUDGET) || 500000;

// 从 LLM 回复提取 JSON(容错处理):
// 1. 剥离 <think>...</think> 思考块(MiniMax 等推理模型默认输出,会污染 JSON 解析)
// 2. 剥离 markdown 代码围栏
// 3. 截取首个 { 或 [ 到末尾对应括号之间的内容
function extractJson(content) {
  let s = String(content || "");
  // 剥 think 块(含嵌套标签变体)
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // 剥代码围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // 定位 JSON 主体(对象或数组)
  const first = s.search(/[[{]/);
  if (first < 0) return null;
  const lastBrace = s.lastIndexOf("}");
  const lastBracket = s.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (end <= first) return null;
  const slice = s.slice(first, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// 音频 MIME 白名单(MediaRecorder 常见输出)
const ALLOWED_AUDIO_MIMES = new Set([
  "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav",
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a",
]);

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_AUDIO_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new ValidationError(`不支持的音频类型:${file.mimetype}(支持 webm/ogg/wav/mp3/m4a)`));
  },
});

// token 预算守卫(与 chat 端点一致,防 LLM 滥用)
function assertBudget() {
  const used = getTodayTokenUsage();
  if (used > DAILY_TOKEN_BUDGET) {
    throw new ValidationError(`已达日 token 预算(${DAILY_TOKEN_BUDGET}),请明天再试`, { code: "RATE_LIMITED" });
  }
}

function makeUsageRecorder(provider, sessionId) {
  return (totalTokens) => {
    try {
      recordTokenUsage(totalTokens, provider, sessionId);
    } catch (e) {
      // token 记录失败不阻塞主流程
    }
  };
}

// ---- 语音转写(本地 whisper) ----
// POST /api/transcribe  multipart: audio(必填), sessionId(必填), agentId?, question?, language?, durationMs?
router.post("/transcribe", audioUpload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) throw new ValidationError("audio 文件为必填");
    const { sessionId, agentId, question, language, durationMs } = req.body;
    if (!sessionId) throw new ValidationError("sessionId 为必填");
    if (!getSession(sessionId)) throw new NotFoundError("会话");

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const ext = path.extname(req.file.originalname) || ".webm";
    const audioName = `${genId("rec")}${ext}`;
    const audioPath = path.join(UPLOAD_DIR, audioName);
    fs.writeFileSync(audioPath, req.file.buffer);

    // 本地 whisper 转写(模型缺失时返回 ok:false,前端降级提示)
    const result = await transcribeAudio(req.file.buffer, language || "zh", DB_DIR_EXPORT);
    const durationSec = Math.max(Number(durationMs) || 0, 0) / 1000;
    const wpm = result.ok ? estimateWPM(result.text, durationSec || (result.chunks.length ? result.chunks.at(-1).timestamp[1] : 0)) : 0;

    let recordingId = null;
    if (result.ok) {
      recordingId = createAnswerRecording({
        sessionId,
        agentId: agentId || null,
        question: question || "",
        audioPath: audioName,
        transcript: result.text,
        wpm,
        durationMs: Number(durationMs) || 0,
        model: result.model,
      }).recordingId;
    }

    res.ok({
      ok: result.ok,
      recordingId,
      text: result.text,
      wpm,
      chunks: result.chunks,
      mode: result.mode,
      error: result.error || null,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/sessions/:id/recordings 语音答题记录列表
router.get("/sessions/:id/recordings", (req, res) => {
  res.ok(listAnswerRecordings(req.params.id));
});

// ---- 逐题反馈(LLM 单题评估) ----
// POST /api/sessions/:id/answers/score  { provider, question, answer }
router.post("/sessions/:id/answers/score", async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    if (!getSession(sessionId)) throw new NotFoundError("会话");
    const { provider, question, answer } = req.body;
    if (!provider) throw new ValidationError("provider 为必填");
    if (!question || !String(question).trim()) throw new ValidationError("question 为必填");
    if (!answer || !String(answer).trim()) throw new ValidationError("answer 为必填");
    assertBudget();

    const prompt = `请以资深面试官视角,对这道面试题的回答做逐题反馈。题目: ${question}
用户回答: ${answer}

严格输出 JSON(不要输出其他内容,不要 markdown 代码块,不要输出思考过程/think 标签):
{
  "score": 1-10 的整数或一位小数,
  "starAnalysis": {"situation": "是否描述情境(1-2句)", "task": "任务目标(1-2句)", "action": "行动(1-2句)", "result": "结果是否量化(1-2句)"},
  "weaknessTags": ["短板标签1", "短板标签2"(2-4个,如: 缺乏量化结果/逻辑跳跃/未用STAR)],
  "improvement": "针对这个回答的具体改进建议(2-3句)",
  "betterAnswer": "更好的回答示例(用STAR结构,150字以内)"
}`;

    const result = await chatProxy(provider, {
      messages: [{ role: "user", content: prompt }],
      stream: false,
      sessionId,
    }, null, makeUsageRecorder(provider, sessionId));

    const parsed = extractJson(result?.content || "");
    if (!parsed || typeof parsed.score !== "number") {
      return res.ok({
        ok: false,
        error: "评估结果解析失败,请重试",
        feedbackId: null,
        raw: (result?.content || "").slice(0, 500),
      });
    }

    const feedbackId = createQuestionFeedback({
      sessionId,
      question: String(question),
      answer: String(answer),
      score: Math.min(Math.max(parsed.score, 0), 10),
      weaknessTags: Array.isArray(parsed.weaknessTags) ? parsed.weaknessTags.slice(0, 6) : [],
      improvement: parsed.improvement || null,
      betterAnswer: parsed.betterAnswer || null,
    }).feedbackId;

    res.ok({
      ok: true,
      feedbackId,
      score: parsed.score,
      starAnalysis: parsed.starAnalysis || null,
      weaknessTags: Array.isArray(parsed.weaknessTags) ? parsed.weaknessTags : [],
      improvement: parsed.improvement || "",
      betterAnswer: parsed.betterAnswer || "",
      degraded: !!result.degraded,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/sessions/:id/answers 逐题反馈列表
router.get("/sessions/:id/answers", (req, res) => {
  res.ok(listQuestionFeedback(req.params.id));
});

// PUT /api/answers/:feedbackId/missed  { isMissed } 错题标记
router.put("/answers/:feedbackId/missed", (req, res) => {
  const isMissed = !!req.body?.isMissed;
  setQuestionMissed(req.params.feedbackId, isMissed);
  res.ok({ ok: true, isMissed });
});

// DELETE /api/answers/:feedbackId 删除一条反馈
router.delete("/answers/:feedbackId", (req, res) => {
  deleteQuestionFeedback(req.params.feedbackId);
  res.ok({ ok: true });
});

// ---- 简历/JD 押题 ----
// POST /api/analysis/predict-questions  { provider, materialId?, resumeText?, jdText? }
router.post("/analysis/predict-questions", async (req, res, next) => {
  try {
    const { provider, materialId, resumeText, jdText } = req.body;
    if (!provider) throw new ValidationError("provider 为必填");

    let resume = resumeText || "";
    if (!resume && materialId) {
      const mat = getMaterialContent(materialId);
      if (mat?.rawText) resume = mat.rawText.slice(0, 20000);
    }
    if (!resume || !resume.trim()) throw new ValidationError("需要简历文本(materialId 或 resumeText)");
    assertBudget();

    const jd = (jdText || "").trim();
    const prompt = `你是一位资深面试官,根据候选人的简历${jd ? "和目标岗位 JD" : ""},预测面试最可能被问到的问题。
简历: ${resume.slice(0, 20000)}
${jd ? `岗位 JD: ${jd.slice(0, 10000)}` : ""}

输出 6-8 道押题,严格输出 JSON 数组(不要输出其他内容,不要 markdown 代码块,不要输出思考过程/think 标签,字符串内不要使用换行):
[
  {"question": "具体问题(一句话)", "category": "技术/项目/行为/场景/动机", "difficulty": 3, "intent": "面试官想考察什么(一句话)", "keyPoints": "要点1;要点2;要点3(用分号分隔,不要用数组)"}
]`;

    const result = await chatProxy(provider, {
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }, null, makeUsageRecorder(provider, null));

    let questions = [];
    const parsed = extractJson(result?.content || "");
    if (Array.isArray(parsed)) {
      questions = parsed.filter((q) => q && typeof q.question === "string").slice(0, 8);
    }

    if (questions.length === 0) {
      return res.ok({ ok: false, questions: [], error: "押题结果解析失败,请重试" });
    }
    res.ok({ ok: true, questions, degraded: !!result.degraded });
  } catch (e) {
    next(e);
  }
});

export default router;
