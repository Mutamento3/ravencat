/** 解析去电决策模型输出，并保留历史自由文本接听兼容。 */

import type { AIOutgoingCallDecision } from './CallRuntimeTypes';

export function parseOutgoingCallDecision(rawText: string): AIOutgoingCallDecision {
  const raw = String(rawText || '').trim();
  const withoutFence = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  const jsonText = start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;

  try {
    const parsed = JSON.parse(jsonText) as {
      decision?: unknown;
      spokenText?: unknown;
      rejectionReason?: unknown;
    };
    if (parsed.decision === 'reject') {
      return { decision: 'reject', rejectionReason: String(parsed.rejectionReason || '').trim() };
    }
    if (parsed.decision === 'accept') {
      return { decision: 'accept', spokenText: String(parsed.spokenText || '').trim() };
    }
  } catch {
    // 历史 Provider 可能返回自由文本，继续按接听后的第一句话处理。
  }

  return { decision: 'accept', spokenText: raw };
}

