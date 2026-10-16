/** 组装 Companion 的仓储、聊天投递与 Android 原生运行时能力。 */

import { aiAssistantRepository } from '@features/assistants';
import { momentRepository } from '@features/moments';
import { protocolRepository } from '@features/protocol';
import { userProfileRepository } from '@features/profile';
import { ledgerRepository } from '@features/wallet';
import {
  addCompanionExecutionCancelListener,
  cancelCompanionWakeExecution,
} from '@features/companion';
import {
  configureCompanionRuntimeDependencies,
  companionSettingsRepository,
  companionStateRepository,
  aiScheduleRepository,
  proactiveLifeReadRepository,
  companionNativeAdapter,
} from '@features/companion/composition';
import {
  findCommittedAssistantMessageIdByRelatedSource,
  getCanonicalChatConversation,
  resolveCanonicalConversation,
  resolveCanonicalChatSourceMessages,
  findFirstVisibleTimelineAnchorsByRunIds,
  runChatVisibleAgent,
  listChatAgentActivityEvidence,
} from '@features/chat';
import {
  deletePersistedChatAttachment,
  messageRepository,
  persistChatImageAttachment,
  sendUserMessageInternal,
} from '@features/chat/composition';
import { initDatabase } from '@platform/persistence';
import {
  getNotificationDiagnostics,
  requestNotificationPermission,
  createRandomUUID,
} from '@platform/device';
import {
  assembleResolvedChatPromptPack,
  assembleResolvedStandalonePromptPack,
} from '@host/prompt';
import { ToolContext } from '@shared/aiTools';
import {
  buildToolsDescription,
  getRuntimeAllowedToolNamesForAI,
  resolveAllowedToolNames,
  resolveMcpExposure,
} from './agent';
import { completePendingBackupRestore } from './completePendingBackupRestore';
import { prepareHostModelRun } from '../runtime/HostModelRunPreparation';

let configured = false;

export function configureCompanionRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configureCompanionRuntimeDependencies({
    chat: {
      listAgentActivityEvidence: listChatAgentActivityEvidence,
      getCanonicalConversation: getCanonicalChatConversation,
      resolveCanonicalConversation,
      resolveCanonicalSourceMessages: resolveCanonicalChatSourceMessages,
      findFirstVisibleTimelineAnchorsByRunIds,
      runVisibleAgent: runChatVisibleAgent,
      findCommittedAssistantMessageIdByRelatedSource,
      sendUserMessageFromExecutionHost: async ({
        message,
        aiConfig,
        correlationId,
        replyCallbacks,
      }) => sendUserMessageInternal(message, aiConfig, {
        // Companion Headless task 本身会等待 terminal，才能持有 inline execution 生命周期。
        executionMode: 'inline_current_host',
        deliveryTiming: 'immediate',
        correlationId,
        replyCallbacks: {
          onReplySegment: (payload) => replyCallbacks.onReplySegment?.(payload),
          onFinalReply: (payload) => replyCallbacks.onFinalReply?.({
            sessionId: payload.sessionId,
            text: payload.text,
            previewText: payload.previewText,
            joinedText: payload.joinedText,
            segments: payload.segments.map((segment) => ({
              messageId: segment.messageId,
              segmentIndex: segment.segmentIndex,
              text: segment.text,
            })),
          }),
          onReplyCommitted: () => replyCallbacks.onReplyCommitted?.(),
          onReplyFailed: (payload) => replyCallbacks.onReplyFailed?.({
            sessionId: payload.sessionId,
            messageId: payload.messageId,
            previewText: payload.previewText,
            error: payload.error,
          }),
        },
      }),
    },
    runPreparation: {
      prepare: prepareHostModelRun,
    },
    tools: {
      createContext: (params) => new ToolContext({
        ...params,
        repositories: {
          message: messageRepository,
          protocol: protocolRepository,
          moment: momentRepository,
          profile: userProfileRepository,
          ledger: ledgerRepository,
        },
      }),
      buildDescription: buildToolsDescription,
      getRuntimeAllowedNames: getRuntimeAllowedToolNamesForAI,
      resolveAllowedNames: resolveAllowedToolNames,
      resolveMcpExposure,
    },
    repositories: {
      assistants: aiAssistantRepository,
      companionSettings: companionSettingsRepository,
      companionState: companionStateRepository,
      aiSchedules: aiScheduleRepository,
      proactiveLife: proactiveLifeReadRepository,
    },
    chatDelivery: {
      persistImageAttachment: persistChatImageAttachment,
      deletePersistedAttachment: deletePersistedChatAttachment,
    },
    notifications: {
      requestPermission: requestNotificationPermission,
      getDiagnostics: async () => {
        const diagnostics = await getNotificationDiagnostics('raven-cat');
        return {
          ...diagnostics,
          channelImportance: diagnostics.messageChannelImportance,
        };
      },
    },
    prompt: {
      assembleChatPromptPack: assembleResolvedChatPromptPack,
      assembleStandalonePromptPack: assembleResolvedStandalonePromptPack,
    },
    native: {
      companion: companionNativeAdapter,
    },
    generateAIScheduleId: () => `ai-schedule-${createRandomUUID()}`,
    generateAutonomousRunId: () => `raven-cat-run-${createRandomUUID()}`,
    initializeDatabase: async () => {
      await completePendingBackupRestore();
      await initDatabase();
    },
  });

  // execution host 超时收口时请求取消当前 autonomous run：
  // 没有这条链路，宿主释放后 Headless JS 仍可能继续无 owner 裸跑。
  addCompanionExecutionCancelListener(({ deliveryEventId }) => {
    const cancelled = cancelCompanionWakeExecution(deliveryEventId);
    if (cancelled) {
      console.info('[RavenCatCompanionRuntime] execution cancel delivered to runner', {
        deliveryEventId,
      });
    }
  });
}
