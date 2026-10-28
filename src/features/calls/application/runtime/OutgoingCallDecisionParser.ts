/** 模型边界只解释精确控制标记；抽离标记后的正文交给原有通话链路。 */

import type { AIOutgoingCallDecision } from './CallRuntimeTypes';
import { CALL_ACCEPT_MARKER, CALL_REJECT_MARKER } from '../CallPromptBlocks';

export function parseOutgoingCallDecision(rawText: string): AIOutgoingCallDecision {
  const accepted = rawText.includes(CALL_ACCEPT_MARKER);
  const rejected = rawText.includes(CALL_REJECT_MARKER);
  if (accepted === rejected) {
    throw new Error(accepted ? '接听与拒绝接听标记不能同时出现' : '回复缺少接听或拒绝接听标记');
  }
  const text = rawText.split(CALL_ACCEPT_MARKER).join('').split(CALL_REJECT_MARKER).join('').trim();
  return accepted
    ? { decision: 'accept', spokenText: text }
    : { decision: 'reject', rejectionReason: text };
}

