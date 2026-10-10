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
  readonly runKey: string;
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

/** 主题只能决定 reasoning 是否可见，不能改变后续 ActionGroup 的分段语义。 */
export function filterReasoningMessagesForPresentation(
  messages: readonly ChatMessage[],
  showReasoningMessages: boolean
): readonly ChatMessage[] {
  return showReasoningMessages
    ? messages
    : messages.filter((message) => message.senderType !== 'reasoning'
      || parseMessageMetadata(message)?.type === 'agentActivity');
}

/** anchor 命中任意 child 时定位到承载它的整个 ActionGroup。 */
export function renderedItemContainsMessageId(
  item: RenderedActionGroupItemLike,
  messageId: number
): boolean {
  return item.actionGroup
    ? item.actionGroup.children.some((child) => child.id === messageId)
    : item.msg.id === messageId;
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
  runKey: string,
  anchorMessage: ChatMessage
): string {
  return `${ACTION_GROUP_KEY_PREFIX}${runKey}:${getAgentTimelineRenderKey(anchorMessage)}`;
}

function isActionGroupRunning(children: readonly ChatMessage[]): boolean {
  return children.some((message) => {
    if (message.status === 'pending' || message.status === 'streaming') {
      return true;
    }

    const metadata = parseMessageMetadata(message);
    return isToolStatusMessageMetadata(metadata) && metadata.status === 'running';
  });
}

function createActionGroup(
  runKey: string,
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
 * 只有相邻、同 run 的 reasoning / tool status 会进入同一组；任何普通消息都会立即
 * flush 当前组。无法解析可靠 run identity 的 legacy 过程消息保持原样，不猜测归属。
 */
export function segmentContiguousAgentActions(
  messages: readonly ChatMessage[]
): ChatPresentationTimelineItem[] {
  const result: ChatPresentationTimelineItem[] = [];
  // 真实语音／贴纸会切开过程组，但同一 run 的各组必须共享最终状态，避免前组永远显示处理中。
  const activityLifecycles = new Map<string, AgentActivityLifecycle>();
  for (const message of messages) {
    const metadata = parseMessageMetadata(message);
    if (metadata?.type !== 'agentActivity') continue;
    const runKey = resolvePresentationRunIdentity(message).key;
    if (!runKey) continue;
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
  let currentRunKey: string | null = null;
  let currentChildren: ChatMessage[] = [];

  const flushCurrentGroup = () => {
    if (!currentRunKey || currentChildren.length === 0) {
      return;
    }

    result.push(createActionGroup(currentRunKey, currentChildren, activityLifecycles.get(currentRunKey) ?? null));
    currentRunKey = null;
    currentChildren = [];
  };

  for (const message of messages) {
    if (!isActionProcessMessage(message)) {
      flushCurrentGroup();
      result.push({ kind: 'message', message });
      continue;
    }

    const runKey = resolvePresentationRunIdentity(message).key;
    if (!runKey) {
      flushCurrentGroup();
      result.push({ kind: 'message', message });
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
