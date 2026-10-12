/** 显式装配后台伴随任务需要的 Chat、AI、Memory 与 Companion 运行时。 */

import { configureAIRuntime } from './configureAIRuntime';
import { configureChatRuntime } from './configureChatRuntime';
import { configureMemoryRuntime } from './configureMemoryRuntime';
import { configureCompanionRuntime } from './configureCompanionRuntime';
import { configurePromptingRuntime } from './configurePromptingRuntime';
import { configureMcpToolsRuntime } from './configureMcpToolsRuntime';
import { configureMediaRuntime } from './configureMediaRuntime';
import { configureAIImageTools } from './configureAIImageTools';
import { configureAIMessageDeliveryCoordinator } from '../runtime/AIMessageDeliveryCoordinator';
import { configureDeviceControlRuntime } from './configureDeviceControlRuntime';
import { configureFloatingLayerRuntime } from './configureFloatingLayerRuntime';
import { configurePhoneToolsRuntime } from './configurePhoneToolsRuntime';
import { configureTogetherListeningRuntime } from './configureTogetherListeningRuntime';
import { configureStickerRuntime } from '@features/stickers/composition';
import { recognizeSticker } from './StickerAnnotationModelGateway';
import { assertImageToolRunCurrent } from './agent/assertImageToolRunCurrent';

let configured = false;

export function configureCompanionHeadlessRuntime(): void {
  if (configured) {
    return;
  }
  configured = true;

  configurePhoneToolsRuntime();
  configureTogetherListeningRuntime();
  configureDeviceControlRuntime();
  configureFloatingLayerRuntime();
  configurePromptingRuntime();
  configureMediaRuntime();
  configureAIImageTools();
  // Agent Sticker 工具可在 Android execution host 中运行，但标注队列只属于前台 Host。
  configureStickerRuntime(recognizeSticker, assertImageToolRunCurrent);
  // Headless execution host 不经过前台页面；MCP Repository/Client 依赖必须在
  // Chat runtime 之前显式装配，冷启动回复才能使用同一套 MCP policy 边界。
  configureMcpToolsRuntime();
  configureChatRuntime();
  configureAIRuntime();
  configureMemoryRuntime();
  configureCompanionRuntime();
  // 统一交付策略随每个 runtime 注册：Headless execution host 落库后也能发系统通知。
  configureAIMessageDeliveryCoordinator();
}
