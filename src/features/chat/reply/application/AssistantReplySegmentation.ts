/** AI 回复的确定性分段：分段由客户端代码决定，不依赖模型输出任何格式标记。 */
import type { BubbleDeliveryMode } from '@shared/prompt';

/** 单段达到该长度后，在下一个完整句末结束气泡，不回头移动已显示的句子。 */
const MAX_SEGMENT_LENGTH = 100;

/** 句末切分点：中英文句末标点之后允许继续切。 */
const SENTENCE_END_PATTERN = /[。！？!?；;…]+["'”’）)]*/g;

/**
 * 把模型输出的纯文本切成气泡段：
 * 1. 按空行切分为候选段；
 * 2. 候选段达到长度阈值后在句末切分；
 * 3. single-bubble 模式下整段一个气泡。
 *
 * 没有句末标点可切的超长段整段保留，不做硬切：硬切会把一句话劈成两个气泡，
 * 宁可让单条气泡更长，也不输出半句话。
 */
export function segmentAssistantReplyText(
  rawText: string,
  bubbleDeliveryMode: BubbleDeliveryMode,
): string[] {
  return segmentAssistantReplyProgress(rawText, bubbleDeliveryMode, true).map(segment => segment.text);
}

/** 增量展示与最终落库共用边界；completed 表示后续文字不会再进入这一泡。 */
export function segmentAssistantReplyProgress(
  rawText: string,
  bubbleDeliveryMode: BubbleDeliveryMode,
  completed: boolean,
): { text: string; completed: boolean }[] {
  if (bubbleDeliveryMode === 'single-bubble') {
    const text = rawText.trim();
    return text ? [{ text, completed }] : [];
  }
  // 保留末尾空行的分隔事实；先 trim 整段会使刚闭合的气泡重新成为活动尾段。
  const paragraphs = rawText.split(/\n\s*\n/);
  return paragraphs.flatMap((rawParagraph, index) => {
    const paragraph = rawParagraph.trim();
    const paragraphCompleted = completed || index < paragraphs.length - 1;
    const segments: { text: string; completed: boolean }[] = [];
    let start = 0;
    SENTENCE_END_PATTERN.lastIndex = 0;
    for (let match = SENTENCE_END_PATTERN.exec(paragraph); match; match = SENTENCE_END_PATTERN.exec(paragraph)) {
      const end = match.index + match[0].length;
      if (end - start < MAX_SEGMENT_LENGTH) continue;
      // 句末后的引号、括号和连续标点可能跨 delta；尾段等后文或终态再确认闭合。
      segments.push({ text: paragraph.slice(start, end).trim(), completed: paragraphCompleted || end < paragraph.length });
      start = end;
    }
    const tail = paragraph.slice(start).trim();
    if (tail) segments.push({ text: tail, completed: paragraphCompleted });
    return segments;
  });
}
