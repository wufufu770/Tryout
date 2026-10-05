// 填充词检测 —— 词边界感知
//
// 背景(W5-1):原实现用 `text.split(w).length - 1` 做**子串**计数,实测问题:
//   "I also think that some people like this approach, because it is basically simple."
//   → "like" 被计 1 次(但那不是填充词)
//   "这个方案我觉得非常好,因为它解决了那个我们一直头疼的问题"
//   → 零填充词的句子被误判 3 次
//
// 两个修正:
//   1. 英文按**词边界**匹配(\b),不是子串。
//   2. 中文虚词从默认词表移除。"那个/这个/就是/然后"在正常中文里是
//      指示代词与连接词,当填充词会**系统性低估中文用户** ——
//      而本项目目标用户以中文为主。宁可漏判也不误判。
//
// 设计原则:**宁可漏判不可误判。** 误报会让用户以为自己表达有问题,
// 那是产品替用户下了它没有依据的结论。

/** 默认填充词表:只保留误判风险低的 */
export const FILLER_WORDS: string[] = [
  // 中文:明确的无意义语气词(不含"那个/这个/就是/然后"等高虚词)
  "嗯", "呃", "唔",
  // 英文:明确的多词填充
  "you know", "i mean", "sort of", "kind of",
  // 英文:需在特定位置才算的"边缘"词,由下面的启发式处理
  "um", "uh", "like", "well", "actually", "basically", "literally",
];

export interface FillerHit {
  word: string;
  index: number;
}

/** 英文词边界正则:左右不能是字母/数字/撇号 */
const EN_WORD = /[A-Za-z]/;

/**
 * 这些词在句中多为实义用法(like=喜欢, well=好, actually=实际上),
 * 只有出现在**明显填充位置**才算。
 * 位置判定:句首、逗号/分号/冒号后、句末。
 */
const EDGE_TOKENS = new Set(["like", "well", "actually", "basically", "literally", "sort of", "kind of"]);

function isEdgePosition(text: string, start: number): boolean {
  if (start === 0) return true;
  // 往前找最近的非空白字符
  for (let i = start - 1; i >= 0; i--) {
    const c = text[i];
    if (/\s/.test(c)) continue;
    return /[,;:!?。！？、]/.test(c);
  }
  return true;
}

export interface FillerResult {
  total: number;
  hits: FillerHit[];
}

export function countFillers(text: string): FillerResult {
  const src = text || "";
  const hits: FillerHit[] = [];
  if (!src.trim()) return { total: 0, hits };

  // 英文:统一小写后按词边界扫描
  const lower = src.toLowerCase();

  for (const w of FILLER_WORDS) {
    const isAscii = /^[a-z' ]+$/.test(w);
    if (!isAscii) {
      // 中文等非 ASCII:直接匹配(词表已剔除高误判虚词)
      let idx = src.indexOf(w);
      while (idx >= 0) {
        hits.push({ word: w, index: idx });
        idx = src.indexOf(w, idx + w.length);
      }
      continue;
    }

    let from = 0;
    while (from < lower.length) {
      const i = lower.indexOf(w, from);
      if (i < 0) break;
      from = i + w.length;

      // 词边界:左
      const leftOk = i === 0 || !EN_WORD.test(lower[i - 1]);
      // 词边界:右(注意多词短语含空格)
      const right = i + w.length;
      const rightOk = right >= lower.length || !EN_WORD.test(lower[right]);
      if (!leftOk || !rightOk) continue;

      // 边缘词需在填充位置
      if (EDGE_TOKENS.has(w) && !isEdgePosition(lower, i)) continue;

      hits.push({ word: w, index: i });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return { total: hits.length, hits };
}
