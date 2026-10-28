/** 按真实时间线把连续的 Agent 过程事件投影为可折叠行动步骤。 */

import { getAgentTimelineRenderKey } from '@features/chat/messages/application/AgentTransientTimeline';
import type { ChatMessage } from '@features/chat/messages/domain/ChatMessage';
import {
  isToolStatusMessageMetadata,
  parseMessageMetadata,
} from '@features/chat/messages/domain';
import { resolvePresentationRunIdentity } from './chatPresentationRun';

const ACTION_GROUP_KEY_PREFIX = 'presentation_action_group:';

interface AgentActivityLifecycle {
  triggerReason?: string;
  responded: boolean;
  finished: boolean;
  terminalCode: string | null;
}

export interface ActionGroupPresentationItem {
  readonly kind: 'action-group';
  readonly key: string;
  readonly runKey: string | null;
  readonly children: readonly ChatMessage[];
  readonly isRunning: boolean;
  readonly activityLifecycle: AgentActivityLifecycle | null;
}

export type ChatPresentationTimelineItem =
  | { readonly kind: 'message'; readonly message: ChatMessage }
  | ActionGroupPresentationItem;

export interface RenderedActionGroupItemLike {
  readonly msg: ChatMessage;
  readonly actionGroup: ActionGroupPresentationItem | null;
}

/** 展示开关只过滤行动过程；正文与其他业务系统消息保持原样。 */
export function filterActionStepsForPresentation(
  messages: readonly ChatMessage[],
  showActionSteps: boolean
): readonly ChatMessage[] {
  return showActionSteps
    ? messages
    : messages.filter((message) => !isActionProcessMessage(message));
}

/** anchor 命中任意 child 时定位到承载它的整个 ActionGroup。 */
export function renderedItemContainsMessageId(
  item: RenderedActionGroupItemLike,
  messageId: number,
  anchorSource?: ChatMessage,
): boolean {
  const children = item.actionGroup ? item.actionGroup.children : [item.msg];
  if (children.some(child => child.id === messageId)) return true;
  // 隐藏触发来源仍是持久导航锚点，定位到该 run 的真实过程或正文。
  return Boolean(anchorSource?.turnRunId && isHiddenActivityLifecycle(anchorSource)
    && children.some(child => child.turnRunId === anchorSource.turnRunId));
}

function isHiddenActivityLifecycle(message: ChatMessage): boolean {
  const metadata = parseMessageMetadata(message);
  return metadata?.type === 'agentActivity'
    && (metadata.phase === 'started' || metadata.phase === 'responded' || metadata.phase === 'terminal');
}

/** 时间分隔以 presentation item 覆盖的最后一条真实 timeline message 为准。 */
export function getLastPresentationTimelineMessage(
  item: ChatPresentationTimelineItem
): ChatMessage {
  return item.kind === 'action-group'
    ? item.children[item.children.length - 1]
    : item.message;
}

export function isActionProcessMessage(message: ChatMessage): boolean {
  if (message.senderType === 'reasoning' && !message.isMe) {
    return true;
  }

  return message.senderType === 'system'
    && (isToolStatusMessageMetadata(parseMessageMetadata(message))
      || parseMessageMetadata(message)?.type === 'agentActivity');
}

export function buildActionGroupPresentationKey(
  runKey: string | null,
  anchorMessage: ChatMessage
): string {
  return `${ACTION_GROUP_KEY_PREFIX}${runKey ?? 'standalone'}:${getAgentTimelineRenderKey(anchorMessage)}`;
}

function isActionGroupRunning(children: readonly ChatMessage[]): boolean {
  return children.some((message) => {
    if (parseMessageMetadata(message)?.interrupted === true) return false;
    if (message.status === 'pending' || message.status === 'streaming') {
      return true;
    }

    const metadata = parseMessageMetadata(message);
    return isToolStatusMessageMetadata(metadata) && metadata.status === 'running';
  });
}

function createActionGroup(
  runKey: string | null,
  children: readonly ChatMessage[],
  activityLifecycle: AgentActivityLifecycle | null,
): ActionGroupPresentationItem {
  const anchorMessage = children[0];
  return {
    kind: 'action-group',
    key: buildActionGroupPresentationKey(runKey, anchorMessage),
    runKey,
    children,
    isRunning: activityLifecycle ? !activityLifecycle.finished : isActionGroupRunning(children),
    activityLifecycle,
  };
}

/**
 * 线性扫描 canonical presentation timeline。
 *
 * 同 run 的 reasoning / tool status 进入同一组；工具产生的群操作结果独立放在
 * 该段行动卡下方，不让后续判断再拆出一张卡。真实发言、用户操作或其他 run
 * 仍立即结束当前组。这里只调整展示，业务消息与模型上下文保留真实发生顺序。
 */
export function segmentContiguousAgentActions(
  messages: readonly ChatMessage[]
): ChatPresentationTimelineItem[] {
  const result: ChatPresentationTimelineItem[] = [];
  // 真实语音／贴纸会切开过程组，但同一 run 的各组必须共享最终状态，避免前组永远显示处理中。
  const activityLifecycles = new Map<string, AgentActivityLifecycle>();
  const legacyLifecycleRuns = new Set<string>();
  for (const message of messages) {
    const metadata = parseMessageMetadata(message);
    if (metadata?.type !== 'agentActivity') continue;
    if (metadata.phase === 'started') continue;
    const runKey = resolvePresentationRunIdentity(message).key;
    if (!runKey) continue;
    if (metadata.phase === 'responded' || metadata.phase === 'terminal') legacyLifecycleRuns.add(runKey);
    const lifecycle = activityLifecycles.get(runKey) ?? {
      triggerReason: metadata.triggerReason, responded: false, finished: false, terminalCode: null,
    };
    if (metadata.phase === 'responded'
      || ((metadata.phase === 'reasoning' || metadata.phase === 'assistant') && message.text.length > 0)) {
      lifecycle.responded = true;
    }
    if (metadata.phase === 'terminal') {
      lifecycle.finished = true;
      lifecycle.terminalCode = metadata.terminalCode ?? null;
    }
    activityLifecycles.set(runKey, lifecycle);
  }
  // 新回合只有真实过程项；静默选择等单项记录不构成另一套运行生命周期。
  for (const runKey of activityLifecycles.keys()) {
    if (!legacyLifecycleRuns.has(runKey)) activityLifecycles.delete(runKey);
  }
  let currentRunKey: string | null = null;
  let currentChildren: ChatMessage[] = [];
  let currentGroupNotices: ChatMessage[] = [];

  const flushCurrentGroup = () => {
    if (!currentRunKey || currentChildren.length === 0) {
      return;
    }

    result.push(createActionGroup(currentRunKey, currentChildren, activityLifecycles.get(currentRunKey) ?? null));
    for (const message of currentGroupNotices) result.push({ kind: 'message', message });
    currentRunKey = null;
    currentChildren = [];
    currentGroupNotices = [];
  };

  for (const message of messages) {
    // 生命周期只提供卡片状态；聊天不额外插入开始、响应和结束说明。
    if (isHiddenActivityLifecycle(message)) continue;
    if (!isActionProcessMessage(message)) {
      if (currentRunKey && message.senderType === 'system'
        && parseMessageMetadata(message)?.type === 'groupMembershipChanged'
        && resolvePresentationRunIdentity(message).key === currentRunKey) {
        currentGroupNotices.push(message);
        continue;
      }
      flushCurrentGroup();
      result.push({ kind: 'message', message });
      continue;
    }

    const runKey = resolvePresentationRunIdentity(message).key;
    if (!runKey) {
      flushCurrentGroup();
      result.push(isToolStatusMessageMetadata(parseMessageMetadata(message))
        ? createActionGroup(null, [message], null)
        : { kind: 'message', message });
      continue;
    }

    if (currentRunKey !== runKey) {
      flushCurrentGroup();
      currentRunKey = runKey;
    }
    currentChildren.push(message);
  }

  flushCurrentGroup();
  return result;
}

export function areActionGroupsEquivalent(
  previous: ActionGroupPresentationItem | null | undefined,
  next: ActionGroupPresentationItem | null | undefined,
  areMessagesEquivalent: (a: ChatMessage, b: ChatMessage) => boolean
): boolean {
  if (previous === next) {
    return true;
  }
  if (!previous || !next) {
    return false;
  }
  return previous.key === next.key
    && previous.runKey === next.runKey
    && previous.isRunning === next.isRunning
    && previous.activityLifecycle?.triggerReason === next.activityLifecycle?.triggerReason
    && previous.activityLifecycle?.responded === next.activityLifecycle?.responded
    && previous.activityLifecycle?.finished === next.activityLifecycle?.finished
    && previous.activityLifecycle?.terminalCode === next.activityLifecycle?.terminalCode
    && previous.children.length === next.children.length
    && previous.children.every((message, index) => (
      areMessagesEquivalent(message, next.children[index])
    ));
}
