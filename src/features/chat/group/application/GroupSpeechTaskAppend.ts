/**
 * AI 回复中的结构化 @ 解析为待物化的发言任务输入（纯读取，不写库）。
 *
 * 所有权边界：正文解析已由 GroupMessageMentionParser 在模型输出边界完成，
 * 这里只消费结构化 mention 事实并做成员资格校验。目标必须仍是当前群的
 * enabled 成员且未被 blocked（blocked 成员可以形成 mention，但不接收发言
 * 事件）。返回的输入由群提交接缝在"mention 所在气泡"的 fence 事务内物化——
 * "@AI" 可见事实与 scheduling consequence 共享同一个 commit 边界：含 @ 的
 * 气泡说出口后，由事务内 future-turn coverage 决定复用已有未来机会或追加新
 * 任务；气泡被 fence 拒绝（未说出口）则两者都不成立，不存在"回复里已经 @ 了
 * B、但 B 的调度后果因时序交错永远消失"的窗口。
 */

import type { GroupMessageMention } from '../../messages/domain/chatMessageMetadata';
import { getChatGroupRuntimeDependencies } from './ChatGroupRuntime';
import type { AppendGroupSpeechTaskInput } from '../domain/GroupChat';

function buildTaskId(): string {
  return `group_task_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function resolveGroupAIMentionSpeechTaskInputs(params: {
  groupId: string;
  mentions: GroupMessageMention[];
}): Promise<AppendGroupSpeechTaskInput[]> {
  const mentionTargets = params.mentions
    .filter((mention) => (
      mention.actorType === 'assistant'
      && mention.target.targetType === 'assistant'
    ))
    .map((mention) => (
      mention.target as Extract<GroupMessageMention['target'], { targetType: 'assistant' }>
    ));
  if (mentionTargets.length === 0) {
    return [];
  }

  const runtime = getChatGroupRuntimeDependencies();
  const members = await runtime.groups.getMembers(params.groupId);
  const memberByAssistantId = new Map(
    members.map((member) => [member.aiAssistantId, member]),
  );

  const inputs: AppendGroupSpeechTaskInput[] = [];
  for (const target of mentionTargets) {
    const member = memberByAssistantId.get(target.assistantId);
    if (!member || !member.enabled) {
      continue;
    }
    const profile = await runtime.assistantDirectory.getById(target.assistantId);
    if (!profile || profile.isBlocked) {
      continue;
    }
    inputs.push({
      id: buildTaskId(),
      groupId: params.groupId,
      aiAssistantId: member.aiAssistantId,
      agentId: member.agentId,
      source: 'ai_mention',
    });
  }
  return inputs;
}
