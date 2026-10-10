import type { PresentationTheme } from './types';

export type ChatPresentationVariant = 'default' | 'moon-kimi' | 'paper-note';

export interface ChatInteractionProfile {
  messageActionSurface: 'long-press-menu' | 'inline-assistant-actions';
  emptyStateSurface: 'default' | 'official-replica';
  reasoningSurface: 'default' | 'official-replica';
  toolStatusSurface: 'system-text' | 'official-replica';
  enableMessageLongPressMenu: boolean;
  /**
   * 语音消息是否可以用长按打开语音专属 action menu（“转文字 / 收起文字”）。
   *
   * 与 `enableMessageLongPressMenu` 分开建模的原因：Moon Kimi 用 inline assistant
   * actions 取代通用长按菜单，但语音气泡没有 inline actions 可以承载 transcript
   * 展开。这不是“通用长按菜单”的例外，而是语音消息自己的可达入口，因此用独立
   * capability 表达，而不是在 theme profile 里堆 if/else 特例。
   */
  enableVoiceMessageLongPressMenu: boolean;
  showAssistantInlineActions: boolean;
  showTokenUsage: boolean;
  showReasoningMessages: boolean;
  enableAssistantMessageSegmentation: boolean;
  preferStreamingReply: boolean;
}

const DEFAULT_CHAT_INTERACTION_PROFILE: ChatInteractionProfile = {
  messageActionSurface: 'long-press-menu',
  emptyStateSurface: 'default',
  reasoningSurface: 'default',
  toolStatusSurface: 'system-text',
  enableMessageLongPressMenu: true,
  enableVoiceMessageLongPressMenu: true,
  showAssistantInlineActions: false,
  showTokenUsage: true,
  showReasoningMessages: true,
  enableAssistantMessageSegmentation: true,
  preferStreamingReply: false,
};

const OFFICIAL_REPLICA_CHAT_INTERACTION_PROFILE: ChatInteractionProfile = {
  messageActionSurface: 'inline-assistant-actions',
  emptyStateSurface: 'official-replica',
  reasoningSurface: 'official-replica',
  toolStatusSurface: 'official-replica',
  enableMessageLongPressMenu: false,
  // 普通文本继续只用 inline actions；语音气泡仍需可达的 transcript 入口。
  enableVoiceMessageLongPressMenu: true,
  showAssistantInlineActions: true,
  showTokenUsage: false,
  showReasoningMessages: true,
  enableAssistantMessageSegmentation: false,
  preferStreamingReply: true,
};

const PAPER_NOTE_CHAT_INTERACTION_PROFILE: ChatInteractionProfile = {
  messageActionSurface: 'long-press-menu',
  emptyStateSurface: 'default',
  reasoningSurface: 'default',
  toolStatusSurface: 'system-text',
  enableMessageLongPressMenu: true,
  enableVoiceMessageLongPressMenu: true,
  showAssistantInlineActions: false,
  showTokenUsage: false,
  showReasoningMessages: false,
  enableAssistantMessageSegmentation: false,
  preferStreamingReply: true,
};

export function getChatPresentationVariant(theme: PresentationTheme): ChatPresentationVariant {
  if (theme.id === 'moon-kimi') {
    return 'moon-kimi';
  }

  return theme.id === 'paper-note' ? 'paper-note' : 'default';
}

export function isMoonKimiTheme(theme: PresentationTheme): boolean {
  return getChatPresentationVariant(theme) === 'moon-kimi';
}

export function isPaperNoteTheme(theme: PresentationTheme): boolean {
  return getChatPresentationVariant(theme) === 'paper-note';
}

export function getChatInteractionProfile(theme: PresentationTheme): ChatInteractionProfile {
  const variant = getChatPresentationVariant(theme);
  if (variant === 'moon-kimi') {
    return OFFICIAL_REPLICA_CHAT_INTERACTION_PROFILE;
  }

  return variant === 'paper-note'
    ? PAPER_NOTE_CHAT_INTERACTION_PROFILE
    : DEFAULT_CHAT_INTERACTION_PROFILE;
}
