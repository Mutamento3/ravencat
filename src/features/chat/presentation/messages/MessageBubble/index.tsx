/** 渲染聊天消息气泡，组合头像、正文、附件、翻译、思维链与工具状态。 */

import React, { memo, useCallback, useMemo, useRef } from 'react';
import { useRecyclingState } from '@shopify/flash-list';
import { useReasoningExpansion } from '../components/reasoningExpansionState';
import { releaseTextSelectionFocus } from '@platform/device';
import {
  View,
  Text,
  Pressable,
  type LayoutChangeEvent,
} from 'react-native';
import { createMessageBubbleStyles, USER_TEXT_COLLAPSE_THRESHOLD } from './styles';
import { GlassSurface, isMoonKimiTheme, isPaperNoteTheme, useTheme } from '@shared/theme';
import { Avatar } from './Avatar';
import { ReplyQuote } from './ReplyQuote';
import { TokenInfo } from './TokenInfo';
import { ReasoningHeader } from './ReasoningHeader';
import OfficialReplicaProcessCard from './OfficialReplicaProcessCard';
import PaperNoteMessageFrame from './PaperNoteMessageFrame';
import type {
  ChatAttachment,
  StickerMessageSnapshot,
  ChatVoiceMessageMetadata,
  ChatReplyQuote,
} from '@features/chat/messages/domain';
import type { MessageStatus, SenderType } from '@features/chat/messages/domain/ChatMessage';
import type { MessageProcessCardState } from './messageBubbleTypes';
import StickerMessageCard from './StickerMessageCard';
import VoiceMessageCard from './VoiceMessageCard';
import {
  createLayoutProbeHandler,
  createPlainTextLayoutProbeHandler,
  isLayoutProbeEnabled,
} from './layoutProbe';
import {
  BubbleAttachmentList,
  BubbleTextContent,
  COMMON_PLAIN_TEXT_STYLE,
  MOON_KIMI_AI_PARAGRAPH_SPACING,
  TranslationBlock,
  createMarkdownStylePreset,
  getBubbleVariant,
  shouldRenderMarkdownText,
  shouldUseWideMarkdownLayout,
  type BubbleTranslation,
  type BubbleVariant,
} from './MessageBubbleContent';

import type { SharedChatRecord } from '../../../messages/domain/SharedChatRecord';
import SharedChatRecordCard from '../components/SharedChatRecordView';

interface MessageBubbleProps {
  sharedRecord?: SharedChatRecord | null;
  sharedComment?: string;
  text: string;
  isMe: boolean;
  senderType: SenderType;
  tokensUsed?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  replyToText?: string | null;
  replyQuote?: ChatReplyQuote | null;
  avatar?: string | null;
  userAvatar?: string | null;
  aiId?: string | null;
  agentId?: string | null;
  aiName?: string;
  /** 群聊场景：在 AI 气泡上方显示发送者名，用于区分多个 AI。 */
  showAssistantName?: boolean;
  userName?: string;
  messageStatus?: MessageStatus;
  attachments?: ChatAttachment[];
  sticker?: StickerMessageSnapshot | null;
  messageId: number;
  voice?: ChatVoiceMessageMetadata['voice'] | null;
  voicePlayedAt?: string | null;
  isVoiceTranscriptExpanded?: boolean;
  /**
   * 语音气泡自己的长按入口。语音卡内部已有播放 Pressable，外层
   * TouchableWithoutFeedback 在 Android 上拿不到长按，因此由卡片显式上抛。
   */
  canLongPressVoice?: boolean;
  onVoiceLongPress?: (position: { x: number; y: number }) => void;
  /** 图片卡片持有点击 responder，长按显式交回消息操作所有者。 */
  onAttachmentLongPress?: (position: { x: number; y: number }) => void;
  translation?: BubbleTranslation | null;
  onHideTranslation?: () => void;
  renderState?: {
    variant: BubbleVariant;
    hasTextContent: boolean;
    hasAttachments: boolean;
    hasSticker: boolean;
    hasVoice: boolean;
    shouldUseMarkdown: boolean;
    isStandaloneAttachmentMessage: boolean;
    isStandaloneStickerMessage: boolean;
    isReasoning: boolean;
    isSystem: boolean;
    isToolStatusMessage: boolean;
  };
  processCard?: MessageProcessCardState | null;
  /** 该消息所属 presentation run 键；仅供开发态布局探针诊断。 */
  presentationRunKey?: string | null;
  reasoningSurface?: 'default' | 'official-replica';
  processCardSurface?: 'none' | 'official-replica';
  onNestedScrollActiveChange?: (isActive: boolean) => void;
  onPreviewFile: (params: { fileUri: string; fileName: string; mimeType?: string | null }) => void;
  isSelected?: boolean;
}

/** legacy 单条 reasoning 的 official-replica 标题；现代 Agent 过程由 ActionGroup 承载。 */
function buildReasoningProcessCardTitle(isInProgress: boolean): string {
  return isInProgress ? '思考中...' : '思考已完成';
}

function areRenderStatesEquivalent(
  previousState: MessageBubbleProps['renderState'],
  nextState: MessageBubbleProps['renderState']
) {
  if (previousState === nextState) {
    return true;
  }

  if (!previousState || !nextState) {
    return previousState === nextState;
  }

  return (
    previousState.variant === nextState.variant &&
    previousState.hasTextContent === nextState.hasTextContent &&
    previousState.hasAttachments === nextState.hasAttachments &&
    previousState.hasSticker === nextState.hasSticker &&
    previousState.hasVoice === nextState.hasVoice &&
    previousState.shouldUseMarkdown === nextState.shouldUseMarkdown &&
    previousState.isStandaloneAttachmentMessage === nextState.isStandaloneAttachmentMessage &&
    previousState.isStandaloneStickerMessage === nextState.isStandaloneStickerMessage &&
    previousState.isReasoning === nextState.isReasoning &&
    previousState.isSystem === nextState.isSystem &&
    previousState.isToolStatusMessage === nextState.isToolStatusMessage
  );
}

function MessageBubble({
  text,
  isMe,
  senderType,
  tokensUsed,
  promptTokens,
  completionTokens,
  cachedTokens,
  replyToText,
  replyQuote,
  avatar,
  userAvatar,
  aiId,
  agentId,
  aiName,
  showAssistantName = false,
  userName,
  messageStatus = 'sent',
  attachments = [],
  sharedRecord = null,
  sharedComment = '',
  sticker = null,
  messageId,
  voice = null,
  voicePlayedAt,
  isVoiceTranscriptExpanded = false,
  canLongPressVoice = false,
  onVoiceLongPress,
  onAttachmentLongPress,
  translation,
  onHideTranslation,
  renderState,
  processCard,
  presentationRunKey,
  reasoningSurface = 'default',
  processCardSurface = 'none',
  onNestedScrollActiveChange,
  onPreviewFile,
  isSelected,
}: MessageBubbleProps) {
  const theme = useTheme();
  const bubbleStyles = useMemo(() => createMessageBubbleStyles(theme), [theme]);
  const isMoonKimi = isMoonKimiTheme(theme);
  const isPaperNote = isPaperNoteTheme(theme);
  const shouldRenderOfficialReplicaReasoning = reasoningSurface === 'official-replica';
  const shouldRenderToolProcessCard = Boolean(
    processCard && processCardSurface === 'official-replica'
  );

  const plainTextStyleByVariant = useMemo(() => ({
    me: [bubbleStyles.myText, COMMON_PLAIN_TEXT_STYLE],
    ai: [bubbleStyles.aiText, COMMON_PLAIN_TEXT_STYLE],
    reasoning: [bubbleStyles.reasoningText, COMMON_PLAIN_TEXT_STYLE],
    system: [bubbleStyles.systemText, COMMON_PLAIN_TEXT_STYLE],
  }), [bubbleStyles]);

  const containerStyleByVariant = useMemo(() => ({
    me: bubbleStyles.myContainer,
    ai: bubbleStyles.aiContainer,
    reasoning: bubbleStyles.reasoningContainer,
    system: bubbleStyles.systemContainer,
  }), [bubbleStyles]);

  const bubbleStyleByVariant = useMemo(() => ({
    me: [bubbleStyles.bubble, bubbleStyles.myBubble],
    ai: [bubbleStyles.bubble, bubbleStyles.aiBubble],
    reasoning: bubbleStyles.reasoningContent,
    system: [bubbleStyles.bubble, bubbleStyles.systemBubble],
  }), [bubbleStyles]);

  // 展开意图跨回收保留；滚动尺寸必须由当前实例重新测量。
  const [isExpanded, setIsExpanded] = useReasoningExpansion(messageId);
  // 用户长文本的折叠状态同理归 messageId 所有。
  const [isUserTextExpanded, setIsUserTextExpanded] = useRecyclingState(false, [messageId]);
  const currentMessageId = useRef(messageId);
  currentMessageId.current = messageId;
  const toggleRequest = useRef(0);
  const [reasoningBodyHeight, setReasoningBodyHeight] = useRecyclingState(0, [messageId]);
  const [reasoningContentHeight, setReasoningContentHeight] = useRecyclingState(0, [messageId]);
  const fallbackIsReasoning = senderType === 'reasoning';
  const fallbackIsSystem = senderType === 'system';
  const fallbackHasTextContent = Boolean(String(text || '').trim());
  const fallbackHasAttachments = Array.isArray(attachments) && attachments.length > 0;
  const fallbackHasSticker = sticker !== null;
  const fallbackShouldUseMarkdown = !sharedRecord && fallbackHasTextContent && shouldRenderMarkdownText(text);
  const fallbackIsStandaloneAttachmentMessage =
    !sharedRecord &&
    !fallbackIsReasoning &&
    !fallbackIsSystem &&
    !fallbackHasTextContent &&
    attachments.length === 1 &&
    !replyQuote && !replyToText;
  const fallbackIsStandaloneStickerMessage =
    !fallbackIsReasoning &&
    !fallbackIsSystem &&
    !replyQuote && !replyToText &&
    !fallbackHasTextContent &&
    fallbackHasSticker;
  const variant = renderState?.variant || getBubbleVariant(isMe, senderType);
  const isReasoning = renderState?.isReasoning ?? fallbackIsReasoning;
  const isSystem = renderState?.isSystem ?? fallbackIsSystem;
  const isToolStatusMessage = renderState?.isToolStatusMessage ?? false;
  const hasTextContent = renderState?.hasTextContent ?? fallbackHasTextContent;
  const hasAttachments = renderState?.hasAttachments ?? fallbackHasAttachments;
  const hasSticker = renderState?.hasSticker ?? fallbackHasSticker;
  const shouldUseMarkdown = renderState?.shouldUseMarkdown ?? fallbackShouldUseMarkdown;
  const isStandaloneAttachmentMessage =
    renderState?.isStandaloneAttachmentMessage ?? fallbackIsStandaloneAttachmentMessage;
  const isStandaloneStickerMessage =
    renderState?.isStandaloneStickerMessage ?? fallbackIsStandaloneStickerMessage;
  const useWideMarkdownLayout = (
    !isMoonKimi
    && !isPaperNote
    && shouldUseMarkdown
    && shouldUseWideMarkdownLayout(text)
  );
  const bubbleStyle = isToolStatusMessage
    ? [bubbleStyles.bubble, bubbleStyles.systemBubble, bubbleStyles.toolStatusBubble]
    : useWideMarkdownLayout
      ? [bubbleStyleByVariant[variant], bubbleStyles.wideMarkdownBubble]
    : bubbleStyleByVariant[variant];
  const plainTextStyle = isToolStatusMessage
    ? [bubbleStyles.systemText, COMMON_PLAIN_TEXT_STYLE, bubbleStyles.toolStatusText]
    : plainTextStyleByVariant[variant];
  const paragraphSpacing =
    isMoonKimi && (variant === 'ai' || variant === 'reasoning')
      ? MOON_KIMI_AI_PARAGRAPH_SPACING
      : null;
  const containerStyle = shouldRenderToolProcessCard
    ? bubbleStyles.reasoningContainer
    : isToolStatusMessage
      ? bubbleStyles.toolStatusContainer
      : containerStyleByVariant[variant];
  const markdownStyles = useMemo(() => {
    if (!shouldUseMarkdown) return null;
    return createMarkdownStylePreset(variant, theme, bubbleStyles, useWideMarkdownLayout);
  }, [shouldUseMarkdown, useWideMarkdownLayout, variant, theme, bubbleStyles]);
  const shouldRenderBubbleArrow =
    !isMoonKimi &&
    !theme.effects.glass.enabled &&
    !isStandaloneAttachmentMessage &&
    !isStandaloneStickerMessage &&
    (isMe || (!isMe && !isSystem && !isReasoning));
  const shouldUseMoonKimiUserWidth = isMoonKimi && isMe && !isSystem;
  // 仅用户自己的长文本默认折叠；AI 回复有分段展示，系统/思维链不走这里。
  // 语音消息的 transcript 由 VoiceMessageCard 自己承担，不参与折叠。
  const shouldCollapseUserText =
    isMe && !isReasoning && !isSystem && !voice && hasTextContent
    && text.length > USER_TEXT_COLLAPSE_THRESHOLD;
  const shouldUseMoonKimiAssistantWidth = isMoonKimi && !isMe && (!isSystem || shouldRenderToolProcessCard);
  const isReasoningInProgress =
    isReasoning && (messageStatus === 'pending' || messageStatus === 'streaming');
  const isReasoningBodyScrollable =
    isExpanded && reasoningBodyHeight > 0 && reasoningContentHeight > reasoningBodyHeight + 8;
  const shouldUseNativeBubbleGlass =
    theme.effects.glass.enabled &&
    !isStandaloneAttachmentMessage &&
    !isStandaloneStickerMessage &&
    (variant === 'me' || variant === 'ai');

  // 开发态布局探针：默认关闭；关闭时不生成任何 handler，不产生额外渲染开销。
  const layoutProbeHandlers = useMemo(() => {
    if (!isLayoutProbeEnabled()) {
      return null;
    }
    const context = {
      messageId: messageId ?? -1,
      senderType,
      isMe,
      themeId: theme.id,
      isWideMarkdown: useWideMarkdownLayout,
      presentationRunKey: presentationRunKey ?? null,
    };
    return {
      container: createLayoutProbeHandler(context, 'container'),
      bubbleWrapper: createLayoutProbeHandler(context, 'bubbleWrapper'),
      bubbleWithArrow: createLayoutProbeHandler(context, 'bubbleWithArrow'),
      middleView: createLayoutProbeHandler(context, 'middleView'),
      bubble: createLayoutProbeHandler(context, 'bubble'),
      tokenInfo: createLayoutProbeHandler(context, 'tokenInfo'),
      // 纯文本路径的行数/文本高度；Markdown 路径拿不到（见 layoutProbe 注释）。
      plainTextLines: createPlainTextLayoutProbeHandler(context),
      listOuter: createLayoutProbeHandler(context, 'listOuter'),
      listItemContent: createLayoutProbeHandler(context, 'listItemContent'),
    };
  }, [isMe, messageId, presentationRunKey, theme.id, useWideMarkdownLayout, senderType]);

  const handleToggleExpanded = useCallback(async () => {
    const request = ++toggleRequest.current;
    if (isExpanded) {
      await releaseTextSelectionFocus();
      if (currentMessageId.current !== messageId || request !== toggleRequest.current) return;
    }
    // 连点收起和迟到的原生响应都不能把后来请求的展开状态反转。
    setIsExpanded(!isExpanded);
  }, [isExpanded, messageId, setIsExpanded]);

  const handleReasoningBodyLayout = useCallback((event: LayoutChangeEvent) => {
    setReasoningBodyHeight(event.nativeEvent.layout.height);
  }, [setReasoningBodyHeight]);

  const handleReasoningContentSizeChange = useCallback((_width: number, height: number) => {
    setReasoningContentHeight(height);
  }, [setReasoningContentHeight]);

  const textContentNode = !voice ? (
    <BubbleTextContent
      selectable={isReasoning}
      hasTextContent={hasTextContent}
      shouldUseMarkdown={shouldUseMarkdown}
      text={text}
      markdownStyles={markdownStyles}
      plainTextStyle={plainTextStyle}
      paragraphSpacing={paragraphSpacing}
      probeHandlers={layoutProbeHandlers ? {
        plainTextLines: layoutProbeHandlers.plainTextLines,
        listOuter: layoutProbeHandlers.listOuter,
        listItemContent: layoutProbeHandlers.listItemContent,
      } : undefined}
    />
  ) : null;

  const bubbleContent = sharedRecord ? <SharedChatRecordCard messageId={messageId} record={sharedRecord} comment={sharedComment} onPreviewFile={onPreviewFile} onLongPress={onAttachmentLongPress} /> : (
    <>
      {hasAttachments ? (
        <BubbleAttachmentList
          attachments={attachments}
          hasTextContent={hasTextContent}
          isMe={isMe}
          onPreviewFile={onPreviewFile}
          onAttachmentLongPress={onAttachmentLongPress}
          styles={bubbleStyles}
        />
      ) : null}

      {hasSticker ? <StickerMessageCard sticker={sticker!} /> : null}

      {voice && messageId !== undefined ? (
        <VoiceMessageCard
          playbackTarget={{ kind: 'message', id: messageId, isIncoming: !isMe }}
          voice={voice}
          transcript={text}
          isTranscriptExpanded={isVoiceTranscriptExpanded}
          isMe={isMe}
          voicePlayedAt={voicePlayedAt}
          canLongPress={canLongPressVoice}
          onLongPress={onVoiceLongPress}
        />
      ) : null}

      {shouldCollapseUserText ? (
        <View collapsable={false}>
          <View style={isUserTextExpanded ? undefined : bubbleStyles.userTextCollapsedClip}>
            {textContentNode}
          </View>
          <Pressable
            onPress={() => setIsUserTextExpanded(!isUserTextExpanded)}
            hitSlop={8}
            accessibilityRole="button"
            style={bubbleStyles.userTextFoldToggle}
          >
            <Text style={bubbleStyles.userTextFoldToggleText}>
              {isUserTextExpanded ? '收起' : '展开全文'}
            </Text>
          </Pressable>
        </View>
      ) : textContentNode}
    </>
  );

  if (isPaperNote) {
    const speakerName = isSystem
      ? '系统'
      : isReasoning
        ? `${aiName?.trim() || 'AI'}（思考）`
        : isMe
          ? userName?.trim() || '用户'
          : aiName?.trim() || 'AI';

    return (
      <PaperNoteMessageFrame speakerName={speakerName} isSelected={isSelected}>
        {isReasoning ? (
          <ReasoningHeader
            isExpanded={isExpanded}
            onToggle={handleToggleExpanded}
          />
        ) : null}
        {(!isReasoning || isExpanded) ? (
          <View style={bubbleStyles.paperNoteContent}>
            {bubbleContent}
          </View>
        ) : null}
        {!isSystem ? <TokenInfo tokensUsed={tokensUsed} promptTokens={promptTokens} completionTokens={completionTokens} cachedTokens={cachedTokens} isMe={isMe} /> : null}
        {!isSystem && !isReasoning && translation ? (
          <TranslationBlock
            translation={translation}
            isMe={isMe}
            onHide={onHideTranslation}
            styles={bubbleStyles}
          />
        ) : null}
        {!isSystem && !isReasoning && (replyQuote || replyToText) ? (
          <ReplyQuote replyToText={replyToText} quote={replyQuote} messageId={messageId} onPreviewFile={onPreviewFile} isMe={isMe} />
        ) : null}
      </PaperNoteMessageFrame>
    );
  }

  // 普通系统提醒以整行居中；不能套用带头像气泡的收缩、箭头和百分比宽度层。
  if (isSystem && !isToolStatusMessage && !shouldRenderToolProcessCard) {
    return (
      <View style={bubbleStyles.systemContainer} onLayout={layoutProbeHandlers?.container}>
        <View style={bubbleStyles.systemBubble} onLayout={layoutProbeHandlers?.bubble}>
          {bubbleContent}
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        bubbleStyles.container,
        containerStyle,
        useWideMarkdownLayout ? bubbleStyles.wideMarkdownContainer : undefined,
      ]}
      onLayout={layoutProbeHandlers?.container}
    >
      {!isMe && !isReasoning && !isSystem && !isMoonKimi && (
        <View style={bubbleStyles.avatarWrapper}>
          <Avatar
            avatarContent={avatar}
            isUser={false}
            userName={userName}
            aiName={aiName || undefined}
          />
        </View>
      )}
      
      <View
        style={isSystem && !shouldRenderToolProcessCard ? undefined : [
          bubbleStyles.bubbleWrapper,
          isMe ? bubbleStyles.myBubbleWrapper : bubbleStyles.aiBubbleWrapper,
          useWideMarkdownLayout ? bubbleStyles.wideMarkdownBubbleWrapper : undefined,
          shouldUseMoonKimiUserWidth ? bubbleStyles.moonKimiUserBubbleWrapper : undefined,
          shouldUseMoonKimiAssistantWidth ? bubbleStyles.moonKimiAssistantBubbleWrapper : undefined,
        ]}
        onLayout={layoutProbeHandlers?.bubbleWrapper}
      >
        {showAssistantName && variant === 'ai' && aiName ? (
          <Text style={bubbleStyles.assistantNameLabel} numberOfLines={1}>{aiName}</Text>
        ) : null}

        {isReasoning && shouldRenderOfficialReplicaReasoning && (
          <OfficialReplicaProcessCard
            title={buildReasoningProcessCardTitle(isReasoningInProgress)}
            iconName="bulb-outline"
            theme={theme}
            styles={bubbleStyles}
            collapsible
            expanded={isExpanded}
            onToggle={handleToggleExpanded}
            scrollable={isReasoningBodyScrollable}
            showsVerticalScrollIndicator={isReasoningBodyScrollable}
            onBodyLayout={handleReasoningBodyLayout}
            onContentSizeChange={handleReasoningContentSizeChange}
            onNestedScrollActiveChange={onNestedScrollActiveChange}
          >
            {bubbleContent}
          </OfficialReplicaProcessCard>
        )}

        {shouldRenderToolProcessCard && processCard ? (
          <OfficialReplicaProcessCard
            title={processCard.title}
            iconName={processCard.status === 'failed' ? 'alert-circle-outline' : 'construct-outline'}
            theme={theme}
            styles={bubbleStyles}
          />
        ) : null}

        {isReasoning && !shouldRenderOfficialReplicaReasoning && (
          <ReasoningHeader
            isExpanded={isExpanded}
            onToggle={handleToggleExpanded}
          />
        )}

        {(!shouldRenderToolProcessCard && (!isReasoning || (isReasoning && !shouldRenderOfficialReplicaReasoning && isExpanded))) && (
          <View
            style={isSelected ? { position: 'relative' } : undefined}
            onLayout={layoutProbeHandlers?.middleView}
          >
            <View
              style={bubbleStyles.bubbleWithArrow}
              onLayout={layoutProbeHandlers?.bubbleWithArrow}
            >
              {!isMe && shouldRenderBubbleArrow && <View style={bubbleStyles.arrowLeft} />}

              {shouldUseNativeBubbleGlass ? (
                <GlassSurface
                  bordered={false}
                  material={{ cornerRadius: theme.radius.lg }}
                  style={bubbleStyle}
                  onLayout={layoutProbeHandlers?.bubble}
                >
                  {bubbleContent}
                </GlassSurface>
              ) : (
                <View
                  // 同一回收气泡会在无框附件和有背景正文之间切换；保持原生正文容器，
                  // 避免样式改变同时切换 Fabric 的节点折叠状态。
                  collapsable={false}
                  style={(isStandaloneAttachmentMessage || isStandaloneStickerMessage)
                    ? bubbleStyles.framelessAttachmentBubble
                    : bubbleStyle}
                  onLayout={layoutProbeHandlers?.bubble}
                >
                  {bubbleContent}
                </View>
              )}

              {isMe && shouldRenderBubbleArrow && <View style={bubbleStyles.arrowRight} />}
            </View>
            {isSelected && <View style={bubbleStyles.selectedBubbleOverlay} />}
          </View>
        )}
        
        {!isSystem ? (
          layoutProbeHandlers?.tokenInfo ? (
            <View onLayout={layoutProbeHandlers.tokenInfo}>
              <TokenInfo tokensUsed={tokensUsed} promptTokens={promptTokens} completionTokens={completionTokens} cachedTokens={cachedTokens} isMe={isMe} />
            </View>
          ) : (
            <TokenInfo tokensUsed={tokensUsed} promptTokens={promptTokens} completionTokens={completionTokens} cachedTokens={cachedTokens} isMe={isMe} />
          )
        ) : null}
        {!isSystem && !isReasoning && translation ? (
          <TranslationBlock
            translation={translation}
            isMe={isMe}
            onHide={onHideTranslation}
            styles={bubbleStyles}
          />
        ) : null}
        {!isSystem && !isReasoning && (replyQuote || replyToText) ? (
          <ReplyQuote replyToText={replyToText} quote={replyQuote} messageId={messageId} onPreviewFile={onPreviewFile} isMe={isMe} />
        ) : null}
      </View>
      
      {isMe && !isSystem && !isMoonKimi && (
        <View style={bubbleStyles.avatarWrapper}>
          <Avatar avatarContent={userAvatar} isUser={true} userName={userName} aiName={aiName || undefined} />
        </View>
      )}
    </View>
  );
}

function areEqual(prevProps: MessageBubbleProps, nextProps: MessageBubbleProps): boolean {
  return (
    prevProps.text === nextProps.text &&
    prevProps.isMe === nextProps.isMe &&
    prevProps.senderType === nextProps.senderType &&
    prevProps.tokensUsed === nextProps.tokensUsed &&
    prevProps.promptTokens === nextProps.promptTokens &&
    prevProps.completionTokens === nextProps.completionTokens &&
    prevProps.cachedTokens === nextProps.cachedTokens &&
    prevProps.replyToText === nextProps.replyToText &&
    prevProps.replyQuote === nextProps.replyQuote &&
    prevProps.avatar === nextProps.avatar &&
    prevProps.userAvatar === nextProps.userAvatar &&
    prevProps.aiId === nextProps.aiId &&
    prevProps.agentId === nextProps.agentId &&
    prevProps.aiName === nextProps.aiName &&
    prevProps.showAssistantName === nextProps.showAssistantName &&
    prevProps.userName === nextProps.userName &&
    prevProps.messageStatus === nextProps.messageStatus &&
    prevProps.attachments === nextProps.attachments &&
    prevProps.sharedRecord === nextProps.sharedRecord &&
    prevProps.sharedComment === nextProps.sharedComment &&
    prevProps.sticker === nextProps.sticker &&
    prevProps.messageId === nextProps.messageId &&
    prevProps.voice === nextProps.voice &&
    prevProps.voicePlayedAt === nextProps.voicePlayedAt &&
    prevProps.isVoiceTranscriptExpanded === nextProps.isVoiceTranscriptExpanded &&
    prevProps.canLongPressVoice === nextProps.canLongPressVoice &&
    prevProps.onVoiceLongPress === nextProps.onVoiceLongPress &&
    prevProps.onAttachmentLongPress === nextProps.onAttachmentLongPress &&
    prevProps.translation?.text === nextProps.translation?.text &&
    prevProps.translation?.sourceLabel === nextProps.translation?.sourceLabel &&
    prevProps.onHideTranslation === nextProps.onHideTranslation &&
    areRenderStatesEquivalent(prevProps.renderState, nextProps.renderState) &&
    prevProps.processCard?.kind === nextProps.processCard?.kind &&
    prevProps.processCard?.title === nextProps.processCard?.title &&
    prevProps.processCard?.status === nextProps.processCard?.status &&
    prevProps.reasoningSurface === nextProps.reasoningSurface &&
    prevProps.processCardSurface === nextProps.processCardSurface &&
    prevProps.onNestedScrollActiveChange === nextProps.onNestedScrollActiveChange &&
    prevProps.onPreviewFile === nextProps.onPreviewFile &&
    prevProps.isSelected === nextProps.isSelected
  );
}

export default memo(MessageBubble, areEqual);
