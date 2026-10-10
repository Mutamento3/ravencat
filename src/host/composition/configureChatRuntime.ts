/** 将 Chat 的仓储端口与数据库维护能力连接到具体实现。 */
import {
  configureChatRuntimeDependencies,
  configureChatImageModels,
  resolveChatRecognitionModel,
  notifyChatImageModelsChanged,
  chatImageSettingsRepository,
  conversationTurnRepository,
  groupChatRepository,
  messageRepository,
  sessionRepository,
} from '@features/chat/composition';
import { clearDB, getDBInfo } from '@platform/persistence';
import {
  PERSISTENT_MEDIA_CATEGORY,
  persistentMediaStore,
} from '@platform/device';
import {
  aiAssistantRepository,
  aiHostRepository,
  getAuxiliaryModelSelection,
  requireAuxiliaryModel,
  resolveAuxiliaryModel,
  subscribeAuxiliaryModelsChanged,
} from '@features/assistants';
import {
  buildToolsDescription,
  getRuntimeAllowedToolNamesForAI,
  isToolTimelineHidden,
  cancelHostAgentRun,
  runHostAgent,
  resolveMcpExposure,
  resolveAllowedToolNames,
  resolveToolRuntimeContext,
} from './agent';
import { ToolContext } from '@shared/aiTools';
import { momentRepository } from '@features/moments';
import { protocolRepository } from '@features/protocol';
import { userProfileRepository } from '@features/profile';
import { ledgerRepository } from '@features/wallet';
import {
  assembleResolvedChatPromptPack,
  assembleResolvedLedgerPromptPack,
  assembleResolvedStandalonePromptPack,
} from '@host/prompt';
import { prepareTogetherListeningHostModelRun } from '@host/runtime/TogetherListeningRunPreparation';
import { getConversationTurnCoordinator } from '../runtime/ConversationTurnCoordinator';
import {
  MEDIA_ASSET_STORAGE_BACKEND,
  resolveMediaAsset,
} from '@features/media';
import { adoptExistingMediaAssetsWithReference } from './configureMediaRuntime';

let configured = false;

export function configureChatRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configureChatImageModels({
    repository: chatImageSettingsRepository,
    getSelection: (modelConfigId) => getAuxiliaryModelSelection({ capabilityKind: 'ocr', modelConfigId }),
    resolveModel: (modelConfigId) => resolveAuxiliaryModel({ capabilityKind: 'ocr', modelConfigId }),
    requireModel: (modelConfigId) => requireAuxiliaryModel(modelConfigId, 'ocr'),
  });
  subscribeAuxiliaryModelsChanged(notifyChatImageModelsChanged);
  configureChatRuntimeDependencies({
    repositories: {
      messages: messageRepository,
      sessions: sessionRepository,
      groups: groupChatRepository,
      turns: conversationTurnRepository,
    },
    assistantDirectory: {
      list: () => aiAssistantRepository.getAll(),
      getById: (assistantId) => aiAssistantRepository.getById(assistantId),
      getBlockState: async (assistantId) => {
        await aiHostRepository.cleanupExpiredBlocks();
        return aiHostRepository.isAIBlocked(assistantId);
      },
    },
    currentUserDirectory: {
      getCurrent: () => userProfileRepository.ensureDefault(),
    },
    // canonical 用户消息 commit 后：abort 被 supersede 的旧句柄并启动新一轮 claimIfIdle。
    canonicalUserMessage: {
      onCommitted: (payload) =>
        getConversationTurnCoordinator().onCanonicalUserMessageCommitted(payload),
    },
    regeneration: {
      onRequested: (sessionId) => getConversationTurnCoordinator().requestRegenerationFromHost(sessionId),
      onInvalidated: (sessionId) => getConversationTurnCoordinator().abortRegeneration(sessionId),
    },
    legacyChatAttachments: {
      locateLegacyChatFile: async (localUri, attachmentType) => {
        const located = await persistentMediaStore.mapLegacyChatUriToAssetReference({
          uri: localUri,
          category: attachmentType === 'image'
            ? PERSISTENT_MEDIA_CATEGORY.chatImage
            : PERSISTENT_MEDIA_CATEGORY.chatFile,
        });
        return located
          ? {
              storageBackend: MEDIA_ASSET_STORAGE_BACKEND.persistentMedia,
              ...located,
            }
          : null;
      },
      adoptLegacyChatFiles: async (inputs, commit) => {
        const result = await adoptExistingMediaAssetsWithReference(
          inputs,
          ({ transaction, assets }) => commit(transaction, assets),
        );
        return result.value;
      },
    },
    database: {
      clear: clearDB,
      getInfo: getDBInfo,
    },
    media: {
      readAsBase64: async (input) => {
        const localUri = input.kind === 'media_asset'
          ? (await resolveMediaAsset(input.assetId)).localUri
          : input.uri;
        return persistentMediaStore.readAsBase64(localUri);
      },
    },
    vision: {
      resolveOCRModel: resolveChatRecognitionModel,
    },
    agent: {
      run: runHostAgent,
      cancel: cancelHostAgentRun,
    },
    runPreparation: {
      prepare: prepareTogetherListeningHostModelRun,
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
      buildDescription: (config) => {
        const description = buildToolsDescription(config);
        if (description || config.enableTools !== true || !(config.allowedToolNames?.length)) {
          return description;
        }
        // MCP-only 时没有 Built-in 描述，但模型仍会从 Agent Registry 收到 MCP schema。
        return '【工具运行要求】本轮可用工具及参数以 function schema 为准；只在查询真实数据或执行用户明确动作时调用。';
      },
      getRuntimeAllowedNames: getRuntimeAllowedToolNamesForAI,
      resolveAllowedNames: resolveAllowedToolNames,
      resolveMcpExposure,
      resolveRuntimeContext: resolveToolRuntimeContext,
      // MCP 清单读取和真实远端调用都进入 Chat 时间线；隐藏策略只保留 Feature 自有裁决。
      isTimelineHidden: isToolTimelineHidden,
    },
    prompt: {
      assembleChat: assembleResolvedChatPromptPack,
      assembleLedger: assembleResolvedLedgerPromptPack,
      assembleStandalone: assembleResolvedStandalonePromptPack,
    },
  });
}
