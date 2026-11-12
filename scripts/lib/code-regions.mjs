// code-regions.mjs — Markdown 代码区免疫：计算代码区范围并等长掩蔽。
// 背景：parser 是纯状态机逐字符扫标记，不认识 Markdown 代码区——任何文档里的
// 标记示例文本（如 AGENTS.md §6 的字面 `gg'..'gg`）都会被当成真标记误伤。
// 对策：所有解析/检测入口统一对 stripCodeRegions(text) 的结果跑 parse/正则——
// 代码区内容被替换为等长空格，标记字符消失 → 免疫；等长替换保证偏移与行号
// 与原文完全一致 → integrate 写回原文的 sourceRange 依然精确。
// 附带收益：AI 的 contextBefore/After 中代码区被空格化，示例文本不会被误当
// 指令或语义线索（天然防注入）。
//
// 覆盖两类代码区（CommonMark 子集，够用即可）：
//   1. fenced code block：行首 ≤3 空格缩进的 ``` 或 ~~~ 围栏（含开闭围栏行）
//   2. inline code span：同一行内成对反引号包裹（含反引号本身）
// 不覆盖：缩进 4 空格的老式代码块（本仓文档不用，遇到再补）。

/**
 * Compute all code-region ranges in the text.
 * @param {string} text
 * @returns {Array<{start: number, end: number}>} character ranges (end exclusive)
 */
export function computeCodeRegions(text) {
  const regions = [];

  // ── 1) Fenced code blocks (line-based state machine) ──
  const lines = text.split('\n');
  let pos = 0;                 // running char offset of current line start
  let fenceChar = null;        // '`' or '~' while inside a fence
  let fenceStart = 0;
  for (const line of lines) {
    const lineStart = pos;
    const lineEnd = pos + line.length;   // exclude the '\n'
    pos = lineEnd + 1;

    if (fenceChar) {
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (close && close[1][0] === fenceChar) {
        regions.push({ start: fenceStart, end: lineEnd });
        fenceChar = null;
      }
      continue;                 // fence body: no inline scanning here
    }

    const open = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (open) {
      fenceChar = open[1][0];
      fenceStart = lineStart;
    }
  }
  if (fenceChar) regions.push({ start: fenceStart, end: text.length }); // unclosed fence → EOF

  const inFence = (s) => regions.some(r => s >= r.start && s < r.end);

  // ── 2) Inline code spans (single-line, paired backticks) ──
  const inlineRe = /(`+)[^`\n]*?\1(?!`)/g;
  let m;
  while ((m = inlineRe.exec(text)) !== null) {
    const s = m.index;
    if (inFence(s)) continue;   // already covered by a fence
    regions.push({ start: s, end: s + m[0].length });
  }

  return regions;
}

/**
 * True iff character position `pos` falls inside any code region.
 * @param {Array<{start, end}>} regions
 * @param {number} pos
 */
export function inCodeRegions(regions, pos) {
  return regions.some(r => pos >= r.start && pos < r.end);
}

/**
 * Return a copy of `text` with every code region replaced by equal-length
 * spaces. Offset- and line-preserving: any marker OUTSIDE code regions is
 * byte-identical to the original, so positions computed on the stripped text
 * apply to the original text unchanged.
 * @param {string} text
 * @returns {string}
 */
export function stripCodeRegions(text) {
  const regions = computeCodeRegions(text);
  if (regions.length === 0) return text;

  const chars = Array.from(text);
  for (const r of regions) {
    for (let i = r.start; i < r.end && i < chars.length; i++) {
      chars[i] = ' ';
    }
  }
  return chars.join('');
}

export default { computeCodeRegions, inCodeRegions, stripCodeRegions };
