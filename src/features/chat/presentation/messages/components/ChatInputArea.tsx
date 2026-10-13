/** 提供聊天文本输入、附件操作、回复状态与主题快捷面板。 */

import { AppTextInput, showAppDialog } from '@shared/ui';
import React, { useRef, useState, useCallback, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, type LayoutChangeEvent, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BrainCircuit } from 'lucide-react-native';
import ChatEmojiPanel from './ChatEmojiPanel';
import ChatToolPanel from './ChatToolPanel';
import ChatAttachmentComposerTray from './ChatAttachmentComposerTray';
import { ChatVoiceReviewPanel } from './ChatVoiceReviewPanel';
import type {
  AttachmentDraftItem,
  StickerMessageSnapshot,
} from '@features/chat/messages/domain';
import { createInputAreaStyles } from './chatInputStyles';
import { isMoonKimiTheme, ThemedSurface, useTheme } from '@shared/theme';
import { MoonKimiComposer } from './MoonKimiComposer';
import type { MoonKimiQuickAction } from './MoonKimiComposer';
import { resolveTogetherListeningToolPanelHandler } from './chatToolPanelCapability';
import type { ChatComposerSurface } from './useChatComposerSurface';
import type { ChatVoiceMessageReviewDraft, ChatVoiceRecordingState } from './chatTypes';

export type { MoonKimiQuickAction } from './MoonKimiComposer';

const DEFAULT_MOON_KIMI_QUICK_ACTIONS: MoonKimiQuickAction[] = [
  { id: 'memory', label: '记忆', Icon: BrainCircuit },
];

export interface InputAreaReplyTarget {
  id: number;
  text: string;
}

interface ChatInputAreaProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  voiceRecordingState?: ChatVoiceRecordingState;
  /** 语音录制 / STT 的即时失败文案；由输入区直接可见，不走历史消息 error 通道。 */
  voiceRecordingError?: string | null;
  onDismissVoiceRecordingError?: () => void;
  /** 发送前校对 draft。非 null 时输入区切换为校对面板，不再展示普通输入或录音按钮。 */
  voiceReviewDraft?: ChatVoiceMessageReviewDraft | null;
  onVoiceReviewTranscriptChange?: (transcript: string) => void;
  onVoiceReviewSend?: () => Promise<boolean> | boolean;
  onVoiceReviewCancel?: () => Promise<void> | void;
  /**
   * 进入“按住说话”前的 preflight（麦克风权限确认）。
   * 返回 false 表示不进入语音模式，由调用方给出可见错误。
   */
  onVoiceModeEnter?: () => Promise<boolean> | boolean;
  onVoiceRecordingStart?: () => Promise<boolean>;
  onVoiceRecordingFinish?: () => Promise<boolean>;
  onVoiceRecordingCancel?: () => Promise<void>;
  attachmentDraft?: AttachmentDraftItem | null;
  hasReadyAttachment?: boolean;
  isPreparingAttachment?: boolean;
  onRemoveAttachment?: () => void;
  onImagePress?: () => Promise<unknown> | unknown;
  onCameraPress?: () => Promise<unknown> | unknown;
  onFilePress?: () => Promise<unknown> | unknown;
  onStickerPress?: (sticker: StickerMessageSnapshot) => Promise<unknown> | unknown;
  onVideoCallPress?: () => Promise<unknown> | unknown;
  onTogetherListeningPress?: () => Promise<unknown> | unknown;
  disabled?: boolean;
  disabledPlaceholder?: string;
  disabledPressMessage?: string;
  replyTo?: InputAreaReplyTarget | null;
  onCancelReply?: () => void;
  paddingBottom?: number;
  onLayout?: (event: LayoutChangeEvent) => void;
  moonKimiQuickActions?: MoonKimiQuickAction[];
  onMoonKimiQuickActionPress?: (action: MoonKimiQuickAction) => void;
  activeSurface: ChatComposerSurface;
  onActiveSurfaceChange: (surface: ChatComposerSurface) => void;
  surfaceHeight: number;
}

export default function ChatInputArea({
  value,
  onChangeText,
  onSend,
  voiceRecordingState = 'idle',
  voiceRecordingError = null,
  onDismissVoiceRecordingError,
  voiceReviewDraft = null,
  onVoiceReviewTranscriptChange,
  onVoiceReviewSend,
  onVoiceReviewCancel,
  onVoiceModeEnter,
  onVoiceRecordingStart,
  onVoiceRecordingFinish,
  onVoiceRecordingCancel,
  attachmentDraft = null,
  hasReadyAttachment = false,
  isPreparingAttachment = false,
  onRemoveAttachment,
  onImagePress,
  onCameraPress,
  onFilePress,
  onStickerPress,
  onVideoCallPress,
  onTogetherListeningPress,
  disabled = false,
  disabledPlaceholder = '当前不可发送消息',
  disabledPressMessage,
  replyTo,
  onCancelReply,
  paddingBottom = 0,
  onLayout,
  moonKimiQuickActions = DEFAULT_MOON_KIMI_QUICK_ACTIONS,
  onMoonKimiQuickActionPress,
  activeSurface,
  onActiveSurfaceChange,
  surfaceHeight,
}: ChatInputAreaProps) {
  const theme = useTheme();
  const styles = useMemo(() => createInputAreaStyles(theme), [theme]);
  const isMoonKimi = isMoonKimiTheme(theme);
  const inputRef = useRef<TextInput | null>(null);
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const voiceButtonSizeRef = useRef({ width: 0, height: 0 });
  const shouldCancelVoiceRef = useRef(false);
  const voiceStartPromiseRef = useRef<Promise<boolean> | null>(null);
  const hasText = value.trim().length > 0;
  const hasAttachment = Boolean(attachmentDraft);
  const hasFailedAttachment = attachmentDraft?.status === 'failed';
  const canSend = !disabled && !isPreparingAttachment && !hasFailedAttachment && (hasText || hasReadyAttachment);
  const shouldShowSendButton = hasText || hasAttachment;

  const isEmojiPanelVisible = activeSurface === 'stickers';
  const isToolPanelVisible = activeSurface === 'tools';
  const shouldShowMoonKimiQuickActions =
    isMoonKimi &&
    !disabled &&
    activeSurface === 'none' &&
    moonKimiQuickActions.length > 0;

  const showDisabledMessage = useCallback(() => {
    if (disabledPressMessage) {
      showAppDialog({ title: '暂不可发送', message: disabledPressMessage, tone: 'warning' });
    }
  }, [disabledPressMessage]);

  const handleSend = () => {
    if (disabled) {
      showDisabledMessage();
      return;
    }
    if (!canSend) return;

    onSend();

    // Android Edge-to-Edge 模式下，延迟聚焦避免键盘动画冲突
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  // 切换表情面板显示状态
  const toggleEmojiPanel = useCallback(() => {
    if (isEmojiPanelVisible) {
      onActiveSurfaceChange('none');
    } else {
      inputRef.current?.blur();
      Keyboard.dismiss();
      onActiveSurfaceChange('stickers');
    }
  }, [isEmojiPanelVisible, onActiveSurfaceChange]);

  // 切换工具面板显示状态
  const toggleToolPanel = useCallback(() => {
    if (isToolPanelVisible) {
      onActiveSurfaceChange('none');
    } else {
      inputRef.current?.blur();
      Keyboard.dismiss();
      onActiveSurfaceChange('tools');
    }
  }, [isToolPanelVisible, onActiveSurfaceChange]);

  const handleInputFocus = useCallback(() => {
    onActiveSurfaceChange('keyboard');
  }, [onActiveSurfaceChange]);

  const beginVoicePress = useCallback(() => {
    // 只允许从 idle 发起一次新录音。starting 期间（pending start）重复 grant
    // 必须忽略，否则会有第二次 start 与第一次抢同一个 recording 所有权。
    if (
      !onVoiceRecordingStart
      || voiceStartPromiseRef.current
      || voiceRecordingState !== 'idle'
    ) {
      return;
    }
    shouldCancelVoiceRef.current = false;
    voiceStartPromiseRef.current = onVoiceRecordingStart();
  }, [onVoiceRecordingStart, voiceRecordingState]);

  const leaveVoiceMode = useCallback(() => {
    // 退出语音模式属于正式取消：recording 要停掉，pending start（starting）也要作废，
    // 否则旧启动完成后录音会继续在已经退出的语音模式之外存在。
    const hasPendingStart = voiceStartPromiseRef.current !== null;
    voiceStartPromiseRef.current = null;
    if (
      voiceRecordingState === 'recording'
      || voiceRecordingState === 'starting'
      || hasPendingStart
    ) {
      void onVoiceRecordingCancel?.();
    }
    setIsVoiceMode(false);
  }, [onVoiceRecordingCancel, voiceRecordingState]);

  const endVoicePress = useCallback(() => {
    const started = voiceStartPromiseRef.current;
    voiceStartPromiseRef.current = null;
    if (!started) return;
    void started.then(async (didStart) => {
      if (!didStart) return;
      if (shouldCancelVoiceRef.current) await onVoiceRecordingCancel?.();
      else await onVoiceRecordingFinish?.();
    });
  }, [onVoiceRecordingCancel, onVoiceRecordingFinish]);

  const handleStickerPress = useCallback((sticker: StickerMessageSnapshot) => {
    onActiveSurfaceChange('none');
    void Promise.resolve(onStickerPress?.(sticker)).catch((error) => {
      showAppDialog({ title: '表情包发送失败', message: error instanceof Error ? error.message : '发送表情包失败', tone: 'error' });
    });
  }, [onActiveSurfaceChange, onStickerPress]);

  const runAttachmentAction = useCallback(async (
    action: (() => Promise<unknown> | unknown) | undefined,
    fallbackMessage: string
  ) => {
    if (!action) {
      return;
    }

    onActiveSurfaceChange('none');
    try {
      await action();
    } catch (error) {
      showAppDialog({ title: '附件处理失败', message: error instanceof Error ? error.message : fallbackMessage, tone: 'error' });
    }
  }, [onActiveSurfaceChange]);

  const handleImagePress = useCallback(() => {
    void runAttachmentAction(onImagePress, '选择图片失败');
  }, [onImagePress, runAttachmentAction]);

  const handleCameraPress = useCallback(() => {
    void runAttachmentAction(onCameraPress, '拍照失败');
  }, [onCameraPress, runAttachmentAction]);

  const handleFilePress = useCallback(() => {
    void runAttachmentAction(onFilePress, '选择文件失败');
  }, [onFilePress, runAttachmentAction]);

  const handleVideoCallPress = useCallback(() => {
    if (!onVideoCallPress) {
      return;
    }

    onActiveSurfaceChange('none');
    void Promise.resolve(onVideoCallPress()).catch((error) => {
      showAppDialog({ title: '视频电话失败', message: error instanceof Error ? error.message : '发起视频电话失败', tone: 'error' });
    });
  }, [onActiveSurfaceChange, onVideoCallPress]);

  const handleTogetherListeningPress = useCallback(() => {
    if (!onTogetherListeningPress) {
      return;
    }

    onActiveSurfaceChange('none');
    void Promise.resolve(onTogetherListeningPress()).catch((error) => {
      showAppDialog({ title: '一起听失败', message: error instanceof Error ? error.message : '发起一起听失败', tone: 'error' });
    });
  }, [onActiveSurfaceChange, onTogetherListeningPress]);

  const enterVoiceMode = useCallback(() => {
    void (async () => {
      inputRef.current?.blur();
      Keyboard.dismiss();
      onActiveSurfaceChange('none');
      // 进入语音模式前先做麦克风权限 preflight：权限被拒时立刻给出可见错误，
      // 而不是让用户先长按一次才发现麦克风入口“像坏掉”。
      // STT session 不在这里建立，仍然只在真正准备录音时创建。
      if (onVoiceModeEnter && !(await onVoiceModeEnter())) {
        return;
      }
      setIsVoiceMode(true);
    })();
  }, [onActiveSurfaceChange, onVoiceModeEnter]);

  return (
    <View style={styles.container} onLayout={onLayout}>
      {replyTo ? (
        <View style={styles.replyPreviewContainer}>
          <View style={styles.replyPreviewTextContainer}>
            <Text style={styles.replyPreviewText} numberOfLines={1}>
              {replyTo.text}
            </Text>
          </View>
          <TouchableOpacity onPress={onCancelReply} style={styles.replyCancelBtn}>
            <Ionicons name="close-circle" size={25} color={theme.colors.background.app} />
          </TouchableOpacity>
        </View>
      ) : null}

      <ChatAttachmentComposerTray attachment={attachmentDraft} onRemove={onRemoveAttachment} />

      {/* 语音录制 / STT 的即时失败提示。输入区在会话始终挂载，因此这里的错误
          与「历史消息加载失败」独立，不依赖 messages.length === 0。 */}
      {voiceRecordingError ? (
        <TouchableOpacity
          style={styles.voiceErrorBanner}
          activeOpacity={0.8}
          onPress={onDismissVoiceRecordingError}
        >
          <Ionicons name="alert-circle-outline" size={16} color={theme.colors.feedback.error} />
          <Text style={styles.voiceErrorText}>{voiceRecordingError}</Text>
        </TouchableOpacity>
      ) : null}

      {/* 发送前校对面板优先于录音条与普通输入：reviewing / committing 期间
          输入区只服务于这一条尚未提交的语音，避免出现“一边校对一边又发别的东西”。 */}
      {voiceReviewDraft ? (
        <ChatVoiceReviewPanel
          draft={voiceReviewDraft}
          isCommitting={voiceRecordingState === 'committing'}
          onChangeTranscript={onVoiceReviewTranscriptChange ?? (() => undefined)}
          onSend={() => { void onVoiceReviewSend?.(); }}
          onCancel={() => { void onVoiceReviewCancel?.(); }}
          paddingBottom={paddingBottom}
          styles={styles}
          theme={theme}
        />
      ) : isVoiceMode ? (
        <ThemedSurface
          nativeGlass
          style={[styles.inputContainer, { paddingBottom }]}
          variant="inputBar"
        >
          <TouchableOpacity style={styles.voiceButton} onPress={leaveVoiceMode}>
            <Ionicons name="keypad-outline" size={25} color={theme.colors.icon.primary} />
          </TouchableOpacity>
          <View
            style={[styles.input, { alignItems: 'center', justifyContent: 'center' }]}
            onLayout={(event) => { voiceButtonSizeRef.current = event.nativeEvent.layout; }}
            onStartShouldSetResponder={() => !disabled && voiceRecordingState === 'idle'}
            onResponderGrant={beginVoicePress}
            onResponderRelease={endVoicePress}
            onResponderTerminate={() => {
              shouldCancelVoiceRef.current = true;
              endVoicePress();
            }}
            onResponderMove={(event) => {
              const { locationX, locationY } = event.nativeEvent;
              const { width, height } = voiceButtonSizeRef.current;
              shouldCancelVoiceRef.current = locationX < 0 || locationY < 0 || locationX > width || locationY > height;
            }}
          >
            <Text style={{ color: theme.colors.text.primary }}>
              {voiceRecordingState === 'processing'
                ? '识别中…'
                : voiceRecordingState === 'starting'
                  ? '正在准备录音…'
                  : voiceRecordingState === 'recording'
                    ? '松开发送，滑出取消'
                    : '按住说话'}
            </Text>
          </View>
        </ThemedSurface>
      ) : isMoonKimi ? (
        <MoonKimiComposer
          actions={moonKimiQuickActions}
          allowDisabledPress={Boolean(disabled && disabledPressMessage)}
          canSend={canSend}
          disabled={disabled}
          disabledPlaceholder={disabledPlaceholder}
          inputRef={inputRef}
          isInputSurfaceVisible={activeSurface !== 'none'}
          isPreparingAttachment={isPreparingAttachment}
          isToolPanelVisible={isToolPanelVisible}
          onChangeText={onChangeText}
          onDisabledPress={showDisabledMessage}
          onFocus={handleInputFocus}
          onQuickActionPress={onMoonKimiQuickActionPress}
          onSend={handleSend}
          onToggleToolPanel={toggleToolPanel}
          onVoiceModePress={enterVoiceMode}
          paddingBottom={paddingBottom}
          shouldShowQuickActions={shouldShowMoonKimiQuickActions}
          shouldShowSendButton={shouldShowSendButton}
          styles={styles}
          theme={theme}
          value={value}
        />
      ) : (
        <ThemedSurface
          nativeGlass
          style={[styles.inputContainer, { paddingBottom }]}
          variant="inputBar"
        >
          <TouchableOpacity style={styles.voiceButton} onPress={enterVoiceMode}>
            <Ionicons name="mic-outline" size={26} color={theme.colors.icon.primary} />
          </TouchableOpacity>
          <AppTextInput
            ref={inputRef}
            style={styles.input}
            value={value}
            onChangeText={onChangeText}
            placeholder={disabled ? disabledPlaceholder : ''}
            placeholderTextColor={theme.colors.text.tertiary}
            maxLength={500}
            autoGrow
            textAlignVertical="top"
            scrollEnabled
            editable={!disabled}
            blurOnSubmit={false}
            onPressIn={() => {
              if (disabled) {
                showDisabledMessage();
              }
            }}
            onFocus={handleInputFocus}
          />

          {shouldShowSendButton ? (
            <TouchableOpacity
              style={[styles.sendButton, !canSend && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={!canSend && !(disabled && disabledPressMessage)}
            >
              <Text style={styles.sendButtonText}>
                {isPreparingAttachment ? '处理中' : '发送'}
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.rightActions}>
              <TouchableOpacity
                style={[styles.iconButton, isEmojiPanelVisible && styles.iconButtonActive]}
                onPress={toggleEmojiPanel}
              >
                <Ionicons
                  name={isEmojiPanelVisible ? "happy" : "happy-outline"}
                  size={26}
                  color={isEmojiPanelVisible ? theme.colors.text.primary : theme.colors.icon.primary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.iconButton, isToolPanelVisible && styles.iconButtonActive]}
                onPress={toggleToolPanel}
              >
                <Ionicons
                  name={isToolPanelVisible ? "add-circle" : "add-circle-outline"}
                  size={26}
                  color={isToolPanelVisible ? theme.colors.text.primary : theme.colors.icon.primary}
                />
              </TouchableOpacity>
            </View>
          )}
        </ThemedSurface>
      )}

      {/* 表情面板 */}
      {isEmojiPanelVisible && (
        <ChatEmojiPanel
          height={surfaceHeight}
          onStickerPress={handleStickerPress}
        />
      )}

      {/* 工具面板 */}
      {isToolPanelVisible && (
        <ChatToolPanel
          height={surfaceHeight}
          onImagePress={handleImagePress}
          onCameraPress={handleCameraPress}
          onFilePress={handleFilePress}
          onVideoCallPress={onVideoCallPress ? handleVideoCallPress : undefined}
          onTogetherListeningPress={resolveTogetherListeningToolPanelHandler(
            onTogetherListeningPress,
            handleTogetherListeningPress,
          )}
        />
      )}
    </View>
  );
}
