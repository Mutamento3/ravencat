/** 在应用组合入口连接助手、聊天与语音模型解析能力。 */
import { getAssistantDisplayName,
  aiAssistantRepository,
  configureAssistantRuntime,
  getAuxiliaryModelSelection,
  requireAuxiliaryModel,
  resolveAuxiliaryModel,
  subscribeAuxiliaryModelsChanged,
} from '@features/assistants';
import { configureSpeechModelResolver, configureSpeechRecognitionModels, getSpeechRecognitionModelId, notifySpeechRecognitionModelsChanged, speechSettingsRepository } from '@features/speech/composition';
import { configureAssistantVoiceModels, getAssistantVoiceModelId, notifyAssistantVoiceModelsChanged, assistantVoiceSettingsRepository } from '@features/assistants/composition';
import { configureTranslationModels, notifyTranslationModelsChanged, translationSettingsRepository } from '@features/integrations/composition';
import { momentRepository } from '@features/moments';
import { protocolRepository } from '@features/protocol';
import { userProfileRepository } from '@features/profile';
import { ledgerRepository } from '@features/wallet';
import {
  appendExternalAssistantMessage,
  resolveCanonicalConversation,
  upsertCallTimelineEntry,
} from '@features/chat';
import { resolveChatImageModelInput } from '@features/chat/composition';
import {
  callAudioPlayback,
  callBackgroundRepository,
  configureCallBackgroundRuntime,
  callRepository,
  configureCallRuntimeDependencies,
  requestCallCameraPermission,
  requestCallMicrophonePermission,
  createCallExecutionAdapter,
} from '@features/calls/composition';
import { handleUserEndedCallFollowUp } from '@features/calls';
import { disableCompanionProductState, invalidateAISchedulesForRevokedOwner } from '@features/companion';
import {
  assembleResolvedChatPromptPack,
  assembleResolvedStandalonePromptPack,
} from '@host/prompt';

let configured = false;

export function configureAIRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configureTranslationModels({
    repository: translationSettingsRepository,
    getSelection: (modelConfigId) => getAuxiliaryModelSelection({ capabilityKind: 'translation', modelConfigId }),
    requireModel: (modelConfigId) => requireAuxiliaryModel(modelConfigId, 'translation'),
    resolveModel: async (modelConfigId) => {
      const model = await resolveAuxiliaryModel({ capabilityKind: 'translation', modelConfigId });
      return model ? { ...model, metadataJson: model.metadataJson! } : null;
    },
  });

  configureSpeechRecognitionModels({
    repository: speechSettingsRepository,
    getSelection: (modelConfigId) => getAuxiliaryModelSelection({ capabilityKind: 'stt', modelConfigId }),
    requireModel: (modelConfigId) => requireAuxiliaryModel(modelConfigId, 'stt'),
  });
  configureAssistantVoiceModels({
    repository: assistantVoiceSettingsRepository,
    getSelection: (modelConfigId) => getAuxiliaryModelSelection({ capabilityKind: 'tts', modelConfigId }),
    requireModel: (modelConfigId) => requireAuxiliaryModel(modelConfigId, 'tts'),
  });
  configureSpeechModelResolver(async ({ capabilityKind, assistantId }) => {
    const modelConfigId = capabilityKind === 'stt'
      ? await getSpeechRecognitionModelId()
      : assistantId ? await getAssistantVoiceModelId(assistantId) : null;
    return resolveAuxiliaryModel({ capabilityKind, modelConfigId });
  });
  subscribeAuxiliaryModelsChanged(() => {
    notifySpeechRecognitionModelsChanged();
    notifyAssistantVoiceModelsChanged();
    notifyTranslationModelsChanged();
  });
  configureCallBackgroundRuntime(callBackgroundRepository);
  configureCallRuntimeDependencies({
    chat: {
      upsertCallTimelineEntry,
      appendExternalAssistantMessage,
    },
    repositories: {
      calls: callRepository,
      protocol: protocolRepository,
      moment: momentRepository,
      profile: userProfileRepository,
      ledger: ledgerRepository,
    },
    assembleChatPromptPack: assembleResolvedChatPromptPack,
    assembleStandalonePromptPack: assembleResolvedStandalonePromptPack,
    resolveAIConfig: async (aiId) => {
      const assistant = await aiAssistantRepository.getById(aiId);
      if (!assistant) {
        return null;
      }
      return {
        id: assistant.id,
        agentId: assistant.agentId,
        name: assistant.name,
        avatar: assistant.avatar,
        model: assistant.model,
        apiKey: assistant.apiKey || '',
        apiBaseUrl: assistant.apiBaseUrl || '',
        systemPrompt: assistant.systemPrompt || undefined,
        temperature: assistant.temperature,
        topP: assistant.topP,
        disableThinking: assistant.disableThinking,
        maxTokens: assistant.maxTokens,
        privateContextPrimaryLimit: assistant.privateContextPrimaryLimit,
        privateContextSecondaryLimit: assistant.privateContextSecondaryLimit,
        groupContextPrimaryLimit: assistant.groupContextPrimaryLimit,
        groupContextSecondaryLimit: assistant.groupContextSecondaryLimit,
        enableTools: assistant.enableTools,
        allowMultipleBubbles: assistant.allowMultipleBubbles,
        isHostAI: assistant.isHostAI,
        isBlocked: assistant.isBlocked,
      };
    },
    resolveImageModelInput: resolveChatImageModelInput,
    native: {
      audioPlayback: callAudioPlayback,
      requestCallCameraPermission,
      requestMicrophonePermission: requestCallMicrophonePermission,
      execution: createCallExecutionAdapter(
        (id) => `exp+kimiphone:///calls/${encodeURIComponent(id)}`,
        async (assistantId) => {
          const assistant = await aiAssistantRepository.getById(assistantId);
          if (!assistant) throw new Error(`通话角色 ${assistantId} 不存在`);
          return { name: getAssistantDisplayName(assistant), avatar: assistant.avatar };
        },
      ),
    },
    onCallTerminated: handleUserEndedCallFollowUp,
  });
  configureAssistantRuntime({
    resolveCanonicalConversation: (aiId) => resolveCanonicalConversation({ aiId }),
    onHostRelationshipRemoved: async (aiId, reason) => {
      // 跨 Feature fan-out：主理关系移除后，同步收口 Companion 与 AI Schedule 的 future 状态。
      await Promise.all([
        disableCompanionProductState({
          failureCode: reason === 'deleted' ? 'host_ai_removed' : 'host_ai_missing',
          clearHostAI: true,
          expectedHostAIId: aiId,
        }),
        invalidateAISchedulesForRevokedOwner(aiId),
      ]);
    },
  });
}
