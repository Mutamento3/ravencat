/**
 * 群聊在 legacy 分段提交上的最小扩展。
 *
 * processAIReply 仍是唯一回复执行宿主，逐泡落库与投递继续委托给
 * createLegacySegmentedReplyPersistence（群聊保持真实逐泡提交，不接 canonical
 * T3 全量落库）。这里在其之上承担群聊自己的事实：
 *
 * 1. 逐泡提交 fence：每个气泡（含 reasoning）的落库都是
 *    { fence 裁决 + 消息 INSERT + 可见回复标记 } 的单一事务——只有所属 plan
 *    仍 active 且任务仍 running 时该气泡才落库，fence 与 INSERT 之间不可能
 *    插入换代事务。fence 失败抛 ChatReplyRunCancelledError('superseded')，
 *    由投递链路安静收尾：已 commit 的气泡保留，未 commit 的永远不入库。
 *    AbortSignal 只节约请求资源（由执行器经 runtimeContext.abortSignal
 *    接入），落库资格永远以事务内 fence 为准。
 * 2. 首个可见气泡落库与 visible_reply_committed 标记在同一事务完成：用户
 *    消息换代事务据此把该 running 任务视为已发言，不再进入继承队列。
 * 3. 提交前用本轮固定的参与者目录预解析结构化称呼：把同一份 mentions
 *    放入运行时元数据，并把其中有效的 AI @ AI 预解析为待物化任务输入。
 *    物化发生在"mention 所在气泡"自己的提交事务内——"@AI" 可见事实与
 *    scheduling consequence 共享同一个 commit 边界：含 @ 的气泡 commit
 *    成功后，要么已有 future turn 覆盖，要么在事务内新增任务；该气泡被
 *    fence 拒绝（未说出口）则两者都不成立。同一目标在一次回复中被多个
 *    气泡 @ 只裁决一次，不做全局 dedupe。
 * 4. confirmCommitEligible 是错误气泡落库前的持久 fence 探针，
 *    decorateCommitRepository 让错误气泡与正常气泡走同一个 fence 事务：
 *    plan 被换代后旧执行上下文的晚到异常不得再写属于旧 plan 的灰色错误气泡。
 */

import { databaseCoordinator } from '@platform/persistence';
import {
  createLegacySegmentedReplyPersistence,
  type AssistantTurnCommitPort,
} from '../../reply/application/AssistantTurnCommit';
import { ChatReplyRunCancelledError } from '../../reply/application/ChatReplyAbort';
import type { AIReplyRuntimeContext } from '../../reply/application/ChatReplyTypes';
import type { IMessageRepository } from '../../messages/domain/MessageRepository';
import { getChatMessageRuntimeDependencies } from '../../messages/application/ChatMessageRuntime';
import type { GroupMessageMention } from '../../messages/domain/chatMessageMetadata';
import { parseGroupMessageMentions } from './GroupMessageMentionParser';
import { resolveGroupAIMentionSpeechTaskInputs } from './GroupSpeechTaskAppend';
import { getChatGroupRuntimeDependencies } from './ChatGroupRuntime';
import type { GroupParticipantDirectory } from '../domain/GroupParticipantDirectory';
import type { AppendGroupSpeechTaskInput, GroupSpeechTask } from '../domain/GroupChat';

export function createGroupSegmentedReplyPersistence(params: {
  directory: GroupParticipantDirectory;
  task: Pick<
    GroupSpeechTask,
    'id' | 'planId' | 'groupId' | 'aiAssistantId' | 'sequenceOrder'
  >;
}): AssistantTurnCommitPort {
  const legacy = createLegacySegmentedReplyPersistence();

  return {
    ...legacy,
    confirmCommitEligible: () => getChatGroupRuntimeDependencies()
      .groups.isSpeechTaskCommitEligible(
        params.task.planId,
        params.task.id,
      ),
    decorateCommitRepository: (repository) => withCommitFence(
      repository,
      params.task,
      null,
    ),
    persistCompletedAssistantReply: async (commitParams) => {
      // 开头短路 fence：失去资格时省去 mention 解析与整段投递；真正的裁决在
      // 每个气泡的提交事务内。
      const eligible = await getChatGroupRuntimeDependencies()
        .groups.isSpeechTaskCommitEligible(
          params.task.planId,
          params.task.id,
        );
      if (!eligible) {
        throw new ChatReplyRunCancelledError('superseded');
      }

      const mentions = parseGroupMessageMentions({
        text: commitParams.response.text,
        directory: params.directory,
        actorAssistantId: params.task.aiAssistantId,
      });
      // 只做成员资格读取校验；物化发生在各 mention 所在气泡的 fence 事务内。
      const mentionTaskInputs = await resolveGroupAIMentionSpeechTaskInputs({
        groupId: params.task.groupId,
        mentions,
      });
      await legacy.persistCompletedAssistantReply({
        ...commitParams,
        repository: withCommitFence(
          commitParams.repository,
          params.task,
          createMentionTaskMaterialization({
            mentions,
            inputs: mentionTaskInputs,
            directory: params.directory,
            actorAssistantId: params.task.aiAssistantId,
          }),
        ),
        runtimeContext: withGroupMentions(commitParams.runtimeContext, mentions),
      });
    },
  };
}

/**
 * 一次回复内的 mention 调度上下文：预解析的任务输入按目标 assistantId
 * 索引，handledTargets 记录已随气泡 commit 成功完成调度裁决的目标（可能是
 * future coverage，也可能是新任务），保证同一目标在一次回复中被多个气泡 @
 * 时只裁决一次。directory/actorAssistantId 用于在气泡
 * 提交事务内解析该气泡自己文本里的结构化 @。
 */
interface MentionTaskMaterialization {
  inputsByAssistantId: Map<string, AppendGroupSpeechTaskInput>;
  handledTargets: Set<string>;
  directory: GroupParticipantDirectory;
  actorAssistantId: string;
}

function createMentionTaskMaterialization(params: {
  mentions: GroupMessageMention[];
  inputs: AppendGroupSpeechTaskInput[];
  directory: GroupParticipantDirectory;
  actorAssistantId: string;
}): MentionTaskMaterialization | null {
  if (params.mentions.length === 0) {
    return null;
  }
  return {
    inputsByAssistantId: new Map(params.inputs.map((input) => [input.aiAssistantId, input])),
    handledTargets: new Set(),
    directory: params.directory,
    actorAssistantId: params.actorAssistantId,
  };
}

/**
 * 逐泡提交 fence：只覆写 commitMessage（逐泡落库的唯一写入口），把每个气泡的
 * 提交包成 { fence + INSERT + 可见标记 } 单一事务。含 "@AI" 的气泡在同一
 * 事务内裁决对应发言任务（future-turn coverage 或队尾追加）。fence
 * 失败抛取消错误，由 AssistantMessageDelivery 按投递中断收尾；执行器随后的
 * 终态回写带 expectedStatus CAS，对被换代任务安静丢弃。
 */
function withCommitFence(
  repository: IMessageRepository,
  task: Pick<
    GroupSpeechTask,
    'id' | 'planId' | 'aiAssistantId' | 'sequenceOrder'
  >,
  mentionTasks: MentionTaskMaterialization | null,
): IMessageRepository {
  return {
    ...repository,
    commitMessage: (input) => {
      // 只有事务真正 commit 后才能把目标计入已裁决：fence 拒绝或回滚时不得
      // 留下"已处理"假象，否则后续含同一 mention 的气泡会漏掉调度后果。
      const resolvedTargets: string[] = [];
      return databaseCoordinator.transaction(
        {
          name: 'chat.commit-group-assistant-bubble',
          feature: 'chat',
          priority: 'interactive',
        },
        async (transaction) => {
          const groups = getChatGroupRuntimeDependencies().groups;
          const eligible = await groups.isSpeechTaskCommitEligibleInTransaction(
            transaction,
            task.planId,
            task.id,
          );
          if (!eligible) {
            throw new ChatReplyRunCancelledError('superseded');
          }
          const segmentMentions = mentionTasks && input.message.senderType === 'assistant'
            ? parseGroupMessageMentions({
              text: input.message.text,
              directory: mentionTasks.directory,
              actorAssistantId: mentionTasks.actorAssistantId,
            })
            : null;
          const message = await getChatMessageRuntimeDependencies()
            .messages.commitMessageInTransaction(
              transaction,
              segmentMentions === null
                ? input
                : {
                  ...input,
                  message: {
                    ...input.message,
                    metadataJson: replaceGroupChatMentions(
                      input.message.metadataJson!,
                      segmentMentions,
                    ),
                  },
                },
            );
          // 群预览与可见气泡同事务提交，交付事件的 consumer 才能立即读到最新列表事实。
          if (message.senderType !== 'reasoning' && input.previewText !== null) {
            await groups.updatePreviewInTransaction(
              transaction,
              message.sessionId,
              message.id,
              input.previewText ?? message.text,
              message.createdAt,
            );
          }
          await groups.markSpeechTaskReplyCommittedInTransaction(transaction, task.id);
          // mention 所在气泡的 commit 边界即调度事实边界：该气泡说出口，
          // 对应 scheduling consequence 必须在同一事务裁决；该气泡未 commit，
          // 既不能覆盖未来任务，也不能追加新任务。
          if (mentionTasks && segmentMentions) {
            const dueInputs: AppendGroupSpeechTaskInput[] = [];
            for (const mention of segmentMentions) {
              if (mention.actorType !== 'assistant'
                || mention.target.targetType !== 'assistant') {
                continue;
              }
              const targetId = mention.target.assistantId;
              const taskInput = mentionTasks.inputsByAssistantId.get(targetId);
              if (!taskInput || mentionTasks.handledTargets.has(targetId)) {
                continue;
              }
              dueInputs.push(taskInput);
              resolvedTargets.push(targetId);
            }
            if (dueInputs.length > 0) {
              await groups.materializeAIMentionSpeechTasksInTransaction(
                transaction,
                task.planId,
                task,
                dueInputs,
              );
            }
          }
          return message;
        },
      ).then((message) => {
        for (const targetId of resolvedTargets) {
          mentionTasks?.handledTargets.add(targetId);
        }
        return message;
      });
    },
  };
}

/**
 * 回复层会把整轮 runtime metadata 复制给每个分段；群聊的 mention 却属于各自
 * 可见气泡。这里在该气泡的提交事务内以本段解析结果覆写它，避免后泡尚未提交的
 * @ 提前成为前泡事实。
 */
function replaceGroupChatMentions(
  metadataJson: string,
  mentions: GroupMessageMention[],
): string {
  const metadata = JSON.parse(metadataJson) as { groupChat: Record<string, unknown> };
  return JSON.stringify({
    ...metadata,
    groupChat: {
      ...metadata.groupChat,
      mentions,
    },
  });
}

function withGroupMentions(
  runtimeContext: AIReplyRuntimeContext | undefined,
  mentions: GroupMessageMention[],
): AIReplyRuntimeContext {
  if (!runtimeContext?.groupChat) {
    throw new Error('群聊提交接缝需要 runtimeContext.groupChat');
  }

  return {
    ...runtimeContext,
    groupChat: {
      ...runtimeContext.groupChat,
      mentions,
    },
  };
}
