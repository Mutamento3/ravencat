/** Calls 运行时依赖契约；具体跨 Feature 能力由 app 组合入口注入。 */

import type {
  AppendExternalAssistantMessageParams,
  AppendExternalAssistantMessageResult,
  UpsertCallTimelineEntryParams,
  UpsertCallTimelineEntryResult,
} from '@features/chat';
import type { ToolContext, AgentToolExecutionContext } from '@shared/aiTools';
import type { AgentRuntimeRequest, AgentRunModelGateway, AgentRunResult } from '@platform/agentRuntime';
import type { CallAIConfig } from '../../domain/CallAIConfig';
import type { CallSession } from '../../domain/CallSession';
import type { ICallRepository } from '../../domain/CallRepository';
import type {
  AssembleStandalonePromptPackParams,
  PromptPack,
  PromptPackBlock,
  PromptPackRuntimeContext,
} from '@shared/prompt';
import { createRuntimeSlot } from '@shared/runtime/RuntimeSlot';

export interface CallAudioPlaybackSession {
  playbackId: string;
  uri: string;
  finished: Promise<void>;
  stop(): Promise<void>;
}

export interface CallAudioPlaybackPort {
  /** 通信模式和路由属于整通电话，暂停录音或单句播放不会释放。 */
  beginSession(callId: string): Promise<void>;
  endSession(callId: string): Promise<void>;
  play(uri: string): Promise<CallAudioPlaybackSession>;
  stop(): Promise<void>;
  getRouteState(): Promise<CallAudioRouteState | null>;
  subscribeRoute(listener: (state: CallAudioRouteState) => void): () => void;
  /** 请求完成表示系统已确认目标设备，实际图标仍以路由订阅为准。 */
  selectRoute(callId: string, route: CallAudioRoute): Promise<void>;
}

export type CallAudioRoute = 'earpiece' | 'speaker' | 'headset';

export interface CallAudioRouteState {
  callId: string;
  revision: number;
  route: CallAudioRoute | null;
  availableRoutes: CallAudioRoute[];
  pendingRoute: CallAudioRoute | null;
  errorMessage: string | null;
}

export interface CallCameraPermissionResult {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

/** Calls 只持有真实写用例所需的 Chat command，不跨 Feature 泄漏整个仓储。 */
export interface CallChatWritePort {
  upsertCallTimelineEntry(
    params: UpsertCallTimelineEntryParams,
  ): Promise<UpsertCallTimelineEntryResult>;
  appendExternalAssistantMessage(
    params: AppendExternalAssistantMessageParams,
  ): Promise<AppendExternalAssistantMessageResult>;
}

export interface CallRuntimeDependencies {
  agent: {
    prepareTools(aiConfig: CallAIConfig): Promise<{
      allowedToolNames: string[];
      toolsDescription: string;
      mcpServices: { name: string; description: string }[];
      additionalPromptBlocks: PromptPackBlock[];
    }>;
    run(request: AgentRuntimeRequest & {
      modelGateway: AgentRunModelGateway;
      createLegacyContext(context: AgentToolExecutionContext): ToolContext;
    }): Promise<AgentRunResult>;
  };
  chat: CallChatWritePort;
  repositories: {
    calls: ICallRepository;
    protocol: unknown | null;
    moment: unknown | null;
    profile: unknown;
    ledger: unknown | null;
  };
  assembleChatPromptPack(params: {
    sessionId: string;
    currentInput: string;
    aiConfig: CallAIConfig;
    toolContext: ToolContext;
    recentWindowLimit: number;
    runtimeContext: PromptPackRuntimeContext;
    additionalBlocks: PromptPackBlock[];
    allowedToolNames?: string[];
    toolsDescription?: string;
    mcpServices?: { name: string; description: string }[];
  }): Promise<PromptPack>;
  assembleStandalonePromptPack(
    params: AssembleStandalonePromptPackParams
  ): Promise<PromptPack>;
  /** 根据通话里的 AI 标识解析当前可用的模型配置。 */
  resolveAIConfig(aiId: string): Promise<CallAIConfig | null>;
  resolveImageModelInput(params: {
    assistantId: string;
    imageUri: string;
    mimeType?: string | null;
    contextText: string;
    signal?: AbortSignal;
  }): Promise<{
    parts: (
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    )[];
    route: 'direct_vision' | 'ocr' | 'vision_unavailable';
    ocrSucceeded: boolean | null;
  }>;
  native: {
    audioPlayback: CallAudioPlaybackPort;
    requestCallCameraPermission: () => Promise<CallCameraPermissionResult>;
    requestMicrophonePermission: () => Promise<CallCameraPermissionResult>;
    execution: {
      start(call: CallSession): Promise<void>;
      isAlive(callId: string): Promise<boolean>;
      setCamera(callId: string, enabled: boolean, facing: 'front' | 'back'): Promise<void>;
      capture(callId: string): Promise<{ uri: string; width: number; height: number }>;
      deleteSnapshot(uri: string): Promise<void>;
      setMicrophone(callId: string, enabled: boolean): Promise<void>;
      setPresentation(callId: string, fullScreen: boolean): Promise<void>;
      hasOverlayPermission(): Promise<boolean>;
      requestOverlayPermission(): Promise<void>;
    };
  };
  /** 由 Host 接收终态通话事实，Calls 不直接依赖具体的主动联系 Feature。 */
  onCallTerminated?: (call: CallSession) => void | Promise<void>;
}

const callRuntimeSlot = createRuntimeSlot<CallRuntimeDependencies>('Calls');

export function configureCallRuntimeDependencies(dependencies: CallRuntimeDependencies): void {
  callRuntimeSlot.configure(dependencies);
}

export function getCallRuntimeDependencies(): CallRuntimeDependencies {
  return callRuntimeSlot.get();
}
