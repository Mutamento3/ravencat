/** 将工具状态元数据转换为官方卡片展示所需的过程状态。 */

import {
  isToolStatusMessageMetadata,
  type ParsedChatMessageMetadata,
} from '@features/chat/messages/domain';
import type { MessageProcessCardState } from '../MessageBubble/messageBubbleTypes';

export type ToolStatusSurface = 'system-text' | 'official-replica';

export function buildToolStatusProcessCard(
  metadata: ParsedChatMessageMetadata | null | undefined,
  surface: ToolStatusSurface
): MessageProcessCardState | null {
  if (surface !== 'official-replica') {
    return null;
  }

  if (!isToolStatusMessageMetadata(metadata)) {
    return null;
  }

  return {
    kind: 'tool',
    title: metadata.displayText,
    status: metadata.status,
  };
}
