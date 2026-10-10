/**
 * 纯 presentation 的 run-level 展示投影。
 *
 * 为什么需要这一层：
 * - 一次 Agent/reply run 在数据层是**多个 step**。每个 step 都有自己的 reasoning item，
 *   并且 `logicalMessageId` 是 per-step 的（`agent_timeline:<runId>:step:<stepIndex>`）。
 *   这是**正确的提交语义**，不在本层修改。
 * - presentation 需要识别 run，才能让连续过程分段和 footer 归属保持一致。
 *   这层身份投影不能反向改变 runtime/persistence 的提交语义。
 *
 * 本模块只读 `ChatMessage`，输出展示用派生信息，**绝不写回**数据库或 timeline。
 * 不重定义 `logicalMessageId` / `replyStepId`，也不新增持久化字段。
 */

import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import { parseMessageMetadata } from '@features/chat/messages/domain';

/** 只有这些 senderType 属于"用户可见的 assistant 输出"。 */
const ASSISTANT_OUTPUT_SENDER_TYPES = new Set(['assistant']);

export interface PresentationRunIdentity {
  /** 稳定、可跨 transient/persisted 对齐的 run 键；无法确定时为 null。 */
  key: string | null;
  /** key 的来源，便于诊断与测试断言。 */
  source: 'transient-turn-run-id' | 'metadata-reply-run-id' | 'reply-step-id' | 'logical-message-id' | null;
}

/**
 * 解析一条消息所属的 presentation run。
 *
 * 优先级（高 → 低）：
 * 1. transient `turnRunId` —— 当前 JS runtime 尚未 reconciliation 的 item，identity 最权威。
 * 2. `metadata.replyRunId` —— 持久化 metadata 中真正表达"一次 AI 回复运行"的身份。
 * 3. `metadata.replyStepId` —— 仅流式投影写入（值 == 该 turn 的 logicalMessageId）；
 *    它不是 run 级身份，但能证明"同一 step 内的多条消息属于同一回复"。
 * 4. `logicalMessageId` —— 最后的兼容兜底；在 Agent 路径下它是 per-step 的，
 *    因此不会错误地把不同 step 识别成同一个 run。
 *
 * 注意：刻意**不使用**"相邻消息推断 run"。那种猜法在群聊、交错回复、历史加载下都会错。
 */
export function resolvePresentationRunIdentity(
  message: ChatMessage
): PresentationRunIdentity {
  const turnRunId = String(message.turnRunId || '').trim();
  if (turnRunId) {
    return { key: `run:${turnRunId}`, source: 'transient-turn-run-id' };
  }

  const metadata = parseMessageMetadata(message);
  const replyRunId = String(metadata?.replyRunId || '').trim();
  if (replyRunId) {
    return { key: `run:${replyRunId}`, source: 'metadata-reply-run-id' };
  }

  const replyStepId = String(metadata?.replyStepId || '').trim();
  if (replyStepId) {
    return { key: `step:${replyStepId}`, source: 'reply-step-id' };
  }

  const logicalMessageId = String(message.logicalMessageId || '').trim();
  if (logicalMessageId) {
    return { key: `logical:${logicalMessageId}`, source: 'logical-message-id' };
  }

  return { key: null, source: null };
}

/** 便捷投影：只要 key。 */
export function resolvePresentationRunKey(message: ChatMessage): string | null {
  return resolvePresentationRunIdentity(message).key;
}

/** 该消息是否是"用户可见的 assistant 输出"（不含 reasoning / tool / system / user）。 */
function isAssistantVisibleOutput(message: ChatMessage): boolean {
  return !message.isMe && ASSISTANT_OUTPUT_SENDER_TYPES.has(message.senderType);
}

export interface PresentationRunTailFlags {
  /** 该 item 是否是该 run 中最后一个"用户可见 assistant 输出"。 */
  isAssistantOutputTail: boolean;
  /** 该 item 是否是该 run 展示投影中的最后一个 item。 */
  isRunTail: boolean;
}

/**
 * 为 run 计算出展示投影里的尾部归属。
 *
 * 语义区分（**不是同一个概念**）：
 * - `isAssistantOutputTail`：run 内最后一个用户可见 assistant 输出。
 *   Moon Kimi 操作栏、token footer 都挂在这里。
 * - `isRunTail`：run 内最后一个展示 item（可能是一条 reasoning / tool / system）。
 *   它表达"这个 run 的展示到此结束"，供后续需要 run 边界的能力使用。
 *
 * @param runMessages 已经按展示顺序排好序、且属于同一个 run 的消息列表。
 */
export function computePresentationRunTailFlags(
  runMessages: readonly ChatMessage[]
): Map<ChatMessage, PresentationRunTailFlags> {
  const flags = new Map<ChatMessage, PresentationRunTailFlags>();
  if (runMessages.length === 0) {
    return flags;
  }

  let assistantOutputTail: ChatMessage | null = null;
  for (let index = runMessages.length - 1; index >= 0; index -= 1) {
    if (isAssistantVisibleOutput(runMessages[index])) {
      assistantOutputTail = runMessages[index];
      break;
    }
  }
  const runTail = runMessages[runMessages.length - 1];

  for (const message of runMessages) {
    flags.set(message, {
      isAssistantOutputTail: message === assistantOutputTail,
      isRunTail: message === runTail,
    });
  }
  return flags;
}

/**
 * 按 presentation run 计算整条展示时间线的尾部归属。
 *
 * 只在**连续**且属于同一 run 的消息段内计算。
 *
 * 前提（已核实）：同一 run 内的展示 item 在两条链路上都稳定携带同一个 runKey ——
 * transient item 带 `turnRunId`（`AgentTransientTimeline` 写入 `item.runId`）；
 * persisted item 的 `turn_run_id`（commit 事务统一赋值 = `run.runId`）与
 * `metadata.replyRunId`（`buildMessageMetadata`，同源 `run.runId`）值相同。
 * reasoning / assistant / tool status / sticker 四条写入路径都经过这两者之一，
 * 因此"连续同 runKey 段"在现代路径下等价于真实 run 段。
 *
 * 已知边界（**容易被误改**）：内层循环用 `candidateKey !== runKey` 判定段结束，
 * 所以 `key === null` 的 item 只要夹在同一 run 的两条 item 之间，就会把这个 run
 * 切成两段，两段可能各自得到 `isAssistantOutputTail`（重复 footer）。
 * 目前只有 legacy 数据会命中（既无 turn_run_id、也无 replyRunId/replyStepId、也无
 * logicalMessageId）。若未来出现稳定的 `key === null` 真实路径，这里应改为按 runKey
 * 分组而不是按连续段。
 *
 * 这样分段的收益：
 * - 群聊里 AI A / AI B 交错的输出不会被当成一个 run；
 * - 用户消息插入两个 run 之间时自然切段；
 * - 历史分页拼接处也不会把两条不相邻的 run 混在一起。
 */
export function computeRunTailFlagsForTimeline(
  messages: readonly ChatMessage[]
): Map<ChatMessage, PresentationRunTailFlags> {
  const flagsByMessage = new Map<ChatMessage, PresentationRunTailFlags>();

  let index = 0;
  while (index < messages.length) {
    const runKey = resolvePresentationRunIdentity(messages[index]).key;
    if (!runKey) {
      index += 1;
      continue;
    }

    const group: ChatMessage[] = [messages[index]];
    let cursor = index + 1;
    while (cursor < messages.length) {
      const candidateKey = resolvePresentationRunIdentity(messages[cursor]).key;
      if (candidateKey !== runKey) {
        break;
      }
      group.push(messages[cursor]);
      cursor += 1;
    }

    for (const [message, flags] of computePresentationRunTailFlags(group)) {
      flagsByMessage.set(message, flags);
    }
    index = cursor;
  }

  return flagsByMessage;
}
