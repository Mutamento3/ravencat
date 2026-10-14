/** 渲染一个按时间线连续分段得到的 Agent 行动步骤。 */

import React, { memo, useCallback, useMemo, useRef } from 'react';
import { useMappingHelper, useRecyclingState } from '@shopify/flash-list';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { releaseTextSelectionFocus } from '@platform/device';

import {
  isToolStatusMessageMetadata,
  parseMessageMetadata,
} from '@features/chat/messages/domain';
import { getAgentTimelineRenderKey } from '@features/chat/messages/application/AgentTransientTimeline';
import type { ActionGroupPresentationItem } from '../components/chatActionGrouping';
import {
  getChatInteractionProfile,
  useTheme,
  type PresentationTheme,
} from '@shared/theme';
import { createMessageBubbleStyles } from './styles';
import OfficialReplicaProcessCard from './OfficialReplicaProcessCard';
import {
  BubbleTextContent,
  COMMON_PLAIN_TEXT_STYLE,
  MOON_KIMI_AI_PARAGRAPH_SPACING,
  createMarkdownStylePreset,
  shouldRenderMarkdownText,
} from './MessageBubbleContent';

interface ActionGroupProcessCardProps {
  group: ActionGroupPresentationItem;
  onNestedScrollActiveChange?: (isActive: boolean) => void;
}

function createActionGroupStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    container: {
      alignSelf: 'flex-start',
      width: '100%',
      paddingHorizontal: theme.spacing.lg,
    },
    officialWrapper: {
      width: '100%',
    },
    defaultCard: {
      width: '100%',
      marginVertical: theme.spacing.xs,
    },
    defaultHeader: {
      // 标题整行拥有点击，不把触摸目标限制在短标签的文字宽度内。
      alignSelf: 'stretch',
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: theme.spacing.sm,
    },
    defaultChevron: {
      width: 16,
      marginRight: theme.spacing.xs,
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 20,
    },
    defaultLabel: {
      color: theme.colors.text.secondary,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 20,
    },
    defaultBody: {
      // 气泡包装层按内容左对齐，步骤正文必须占满可用宽度，才能分配工具文字的 flex 空间。
      alignSelf: 'stretch',
      marginTop: theme.spacing.xs,
      marginLeft: theme.spacing.md,
      paddingLeft: theme.spacing.md,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: theme.colors.border.default,
    },
    child: {
      paddingVertical: theme.spacing.xs,
    },
    childWithDivider: {
      paddingTop: theme.spacing.md,
      paddingBottom: theme.spacing.xs,
      marginTop: theme.spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.colors.border.default,
    },
    toolRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 24,
    },
    toolIcon: {
      marginRight: theme.spacing.sm,
    },
    toolText: {
      flex: 1,
      fontSize: theme.typography.bodySmall.fontSize,
      lineHeight: 20,
      color: theme.colors.text.secondary,
    },
  });
}

function ActionGroupProcessCard({
  group,
  onNestedScrollActiveChange,
}: ActionGroupProcessCardProps) {
  const theme = useTheme();
  const interactionProfile = getChatInteractionProfile(theme);
  const styles = useMemo(() => createMessageBubbleStyles(theme), [theme]);
  const actionStyles = useMemo(() => createActionGroupStyles(theme), [theme]);
  const reasoningMarkdownStyles = useMemo(
    () => createMarkdownStylePreset('reasoning', theme, styles, false),
    [styles, theme]
  );
  const { getMappingKey } = useMappingHelper();
  // 回收容器切换到另一组时，展开状态和尺寸归新组所有；尺寸变化同步通知列表。
  const [isExpanded, setIsExpanded] = useRecyclingState(false, [group.key]);
  const currentGroupKey = useRef(group.key);
  currentGroupKey.current = group.key;
  const toggleRequest = useRef(0);
  const [bodyHeight, setBodyHeight] = useRecyclingState(0, [group.key]);
  const [contentHeight, setContentHeight] = useRecyclingState(0, [group.key]);
  const isScrollable = isExpanded && bodyHeight > 0 && contentHeight > bodyHeight + 8;
  const isOfficialReplica = interactionProfile.reasoningSurface === 'official-replica'
    && interactionProfile.toolStatusSurface === 'official-replica';
  const activity = group.activityLifecycle;
  const terminalCode = activity?.terminalCode;
  const title = activity
    ? `${activity.triggerReason === 'self_wake' ? '自主醒来' : '日程唤醒'} · ${activity.finished
      ? terminalCode === 'COMPLETED' ? activity.responded ? '已执行' : '未执行' : terminalCode === 'CANCELLED_BY_USER' ? '已取消'
        : terminalCode === 'INTERRUPTED' ? '执行因故障中断' : '执行失误'
      : activity.responded ? 'AI 已响应，正在处理…' : '等待 AI 响应…'}`
    : group.isRunning ? '行动步骤 · 正在处理…' : '行动步骤';

  const handleToggle = useCallback(async () => {
    const request = ++toggleRequest.current;
    if (isExpanded) {
      // 原生焦点必须先释放，之后才能卸载选区；异步期间回收的旧卡片不再改变新组状态。
      await releaseTextSelectionFocus();
      if (currentGroupKey.current !== group.key || request !== toggleRequest.current) return;
    }
    // 连点表达当前标题的同一个目标；旧的异步收起不能反转或覆盖新点击。
    setIsExpanded(!isExpanded);
  }, [group.key, isExpanded, setIsExpanded]);

  const handleBodyLayout = useCallback((event: LayoutChangeEvent) => {
    setBodyHeight(event.nativeEvent.layout.height);
  }, [setBodyHeight]);

  const handleContentSizeChange = useCallback((_width: number, height: number) => {
    setContentHeight(height);
  }, [setContentHeight]);

  const childrenContent = group.children.map((message, index) => {
    const metadata = parseMessageMetadata(message);
    const isToolStatus = isToolStatusMessageMetadata(metadata);
    return (
      <View
        key={getMappingKey(getAgentTimelineRenderKey(message), index)}
        style={index > 0 ? actionStyles.childWithDivider : actionStyles.child}
      >
        {isToolStatus ? (
          <View style={actionStyles.toolRow}>
            <Ionicons
              name={metadata.status === 'failed' ? 'alert-circle-outline' : 'construct-outline'}
              size={16}
              color={theme.colors.icon.secondary}
              style={actionStyles.toolIcon}
            />
            <Text style={actionStyles.toolText}>{metadata.displayText}</Text>
          </View>
        ) : (
          <BubbleTextContent
            selectable={message.senderType === 'reasoning'}
            hasTextContent={Boolean(message.text.trim())}
            shouldUseMarkdown={shouldRenderMarkdownText(message.text)}
            text={message.text}
            markdownStyles={reasoningMarkdownStyles}
            plainTextStyle={[styles.reasoningText, COMMON_PLAIN_TEXT_STYLE]}
            paragraphSpacing={isOfficialReplica ? MOON_KIMI_AI_PARAGRAPH_SPACING : null}
          />
        )}
      </View>
    );
  });

  if (isOfficialReplica) {
    return (
      <View style={actionStyles.container}>
        <View style={[styles.bubbleWrapper, styles.aiBubbleWrapper, actionStyles.officialWrapper]}>
          <OfficialReplicaProcessCard
            title={title}
            iconName="list-outline"
            theme={theme}
            styles={styles}
            collapsible
            expanded={isExpanded}
            onToggle={handleToggle}
            scrollable={isScrollable}
            showsVerticalScrollIndicator={isScrollable}
            onBodyLayout={handleBodyLayout}
            onContentSizeChange={handleContentSizeChange}
            onNestedScrollActiveChange={onNestedScrollActiveChange}
          >
            {childrenContent}
          </OfficialReplicaProcessCard>
        </View>
      </View>
    );
  }

  return (
    <View style={actionStyles.container}>
      <View style={[styles.bubbleWrapper, styles.aiBubbleWrapper, actionStyles.defaultCard]}>
        <TouchableOpacity
          style={actionStyles.defaultHeader}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: isExpanded }}
          onPress={handleToggle}
          activeOpacity={0.7}
        >
          <Text style={actionStyles.defaultChevron}>{isExpanded ? '⌄' : '›'}</Text>
          <Text style={actionStyles.defaultLabel}>{title}</Text>
        </TouchableOpacity>
        {isExpanded ? (
          <View style={actionStyles.defaultBody}>
            {childrenContent}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export default memo(ActionGroupProcessCard);
