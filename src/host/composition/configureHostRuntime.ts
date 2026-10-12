/** 只执行一次的前台宿主运行时装配入口。 */
import { configureChatCallGateway } from '@features/chat/composition';
import { getActiveCall, startOutgoingCall } from '@features/calls';
import { configureWalletRuntime } from '@features/wallet';

import { createWalletChatReplyGateway } from './createWalletChatReplyGateway';
import { configureAIRuntime } from './configureAIRuntime';
import { configureAuxiliaryModelInitializationRuntime } from './configureAuxiliaryModelInitialization';
import { configureChatRuntime } from './configureChatRuntime';
import { configureMemoryRuntime } from './configureMemoryRuntime';
import { configureChatSummary } from './configureChatSummaryRuntime';
import { configureCompanionRuntime } from './configureCompanionRuntime';
import { configurePromptingRuntime } from './configurePromptingRuntime';
import { configureMcpToolsRuntime } from './configureMcpToolsRuntime';
import { configureMediaRuntime } from './configureMediaRuntime';
import { configureAIImageTools } from './configureAIImageTools';
import { configureDeviceControlRuntime } from './configureDeviceControlRuntime';
import { configureFloatingLayerRuntime } from './configureFloatingLayerRuntime';
import { configurePhoneToolsRuntime } from './configurePhoneToolsRuntime';
import { configureTogetherListeningRuntime } from './configureTogetherListeningRuntime';
import { configureStickerRuntime } from '@features/stickers/composition';
import { recognizeSticker } from './StickerAnnotationModelGateway';
import { assertImageToolRunCurrent } from './agent/assertImageToolRunCurrent';
import { configureStickerAnnotationQueue } from '../runtime/StickerAnnotationQueueCoordinator';
import { configureStickerEmbeddingQueue } from '../runtime/StickerEmbeddingQueueCoordinator';
import { configureMomentsRuntime } from './configureMomentsRuntime';

let configured = false;

export function configureHostRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configureAuxiliaryModelInitializationRuntime();

  configurePhoneToolsRuntime();
  configureTogetherListeningRuntime();
  configureDeviceControlRuntime();
  configureFloatingLayerRuntime();
  configureMediaRuntime();
  configureAIImageTools();
  configureMomentsRuntime();
  configureStickerRuntime(recognizeSticker, assertImageToolRunCurrent);
  configureStickerAnnotationQueue();
  configureStickerEmbeddingQueue();
  configureChatCallGateway({
    getActiveCall,
    startOutgoingCall: (params) => startOutgoingCall({
      ...params,
      onCallCreated: params.onCallCreated
        ? (call) => params.onCallCreated?.(call)
        : undefined,
    }),
  });
  configurePromptingRuntime();
  configureChatRuntime();
  configureAIRuntime();
  configureMemoryRuntime();
  configureChatSummary();
  configureCompanionRuntime();
  configureMcpToolsRuntime();
  configureWalletRuntime(createWalletChatReplyGateway());
}
