/** 渲染 Together Listening Activity 生命周期卡片；歌曲与播放进度不属于此组件。 */

import { showAppDialog } from '@shared/ui';
import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Headphones } from 'lucide-react-native';
import { isMoonKimiTheme, isPaperNoteTheme, ThemedSurface, useTheme } from '@shared/theme';
import { Avatar } from '../MessageBubble/Avatar';
import PaperNoteMessageFrame from '../MessageBubble/PaperNoteMessageFrame';
import type {
  ChatTogetherListeningResult,
} from '../../../conversation/application/ChatTogetherListeningGateway';
import type {
  TogetherListeningActivityCardViewModel,
  TogetherListeningCardPresentationIdentity,
  TogetherListeningCardAction,
} from './togetherListeningCardViewModel';

type CardActionHandler = (
  activityId: string,
) => Promise<ChatTogetherListeningResult>;

interface TogetherListeningActivityCardProps {
  viewModel: TogetherListeningActivityCardViewModel;
  identity: TogetherListeningCardPresentationIdentity;
  onAccept?: CardActionHandler;
  onDecline?: CardActionHandler;
  onLeave?: CardActionHandler;
}

function createStyles(theme: ReturnType<typeof useTheme>) {
  const isPaperNote = isPaperNoteTheme(theme);
  return StyleSheet.create({
    wrapper: {
      width: '100%',
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    row: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'flex-start',
      gap: theme.spacing.sm,
    },
    rowMe: {
      justifyContent: 'flex-end',
    },
    card: {
      maxWidth: isPaperNote ? '100%' : '85%',
      minWidth: isPaperNote ? 0 : 230,
      borderRadius: isPaperNote ? 0 : theme.radius.lg,
      borderWidth: isPaperNote ? 0 : StyleSheet.hairlineWidth,
      borderColor: theme.effects.glass.enabled ? theme.effects.glass.borderColor : theme.colors.border.default,
      paddingHorizontal: isPaperNote ? 0 : theme.spacing.md,
      paddingVertical: isPaperNote ? theme.spacing.xs : theme.spacing.md,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: theme.spacing.xs,
    },
    icon: {
      marginRight: theme.spacing.xs,
    },
    title: {
      flexShrink: 1,
      color: theme.colors.text.primary,
      fontSize: 15,
      fontWeight: '700',
    },
    body: {
      color: theme.colors.text.secondary,
      fontSize: 14,
      lineHeight: 20,
    },
    duration: {
      marginTop: theme.spacing.xs,
      color: theme.colors.text.tertiary,
      fontSize: 12,
    },
    actions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    action: {
      minWidth: 64,
      borderRadius: theme.radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.default,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: theme.spacing.xs,
      alignItems: 'center',
    },
    actionPrimary: {
      borderColor: theme.colors.brand.primary,
      backgroundColor: theme.colors.brand.primary,
    },
    actionDisabled: {
      opacity: 0.45,
    },
    actionText: {
      color: theme.colors.text.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    actionPrimaryText: {
      color: theme.colors.brand.onPrimary,
    },
  });
}

const ACTION_LABELS: Record<TogetherListeningCardAction, string> = {
  accept: '一起听',
  decline: '拒绝',
  leave: '退出',
};

function isErrorResult(result: ChatTogetherListeningResult): boolean {
  return (
    result.status === 'unavailable'
    || result.status === 'transition_conflict'
    || result.status === 'failed'
  );
}

function TogetherListeningActivityCard({
  viewModel,
  identity,
  onAccept,
  onDecline,
  onLeave,
}: TogetherListeningActivityCardProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const isPaperNote = isPaperNoteTheme(theme);
  const shouldShowAvatar = !isMoonKimiTheme(theme) && !isPaperNote;
  const [pendingAction, setPendingAction] = useState<TogetherListeningCardAction | null>(null);

  useEffect(() => {
    setPendingAction(null);
  }, [viewModel.activityId, viewModel.phase]);

  const handlers = useMemo<Record<TogetherListeningCardAction, CardActionHandler | undefined>>(
    () => ({
      accept: onAccept,
      decline: onDecline,
      leave: onLeave,
    }),
    [onAccept, onDecline, onLeave],
  );

  const handleAction = useCallback(async (action: TogetherListeningCardAction) => {
    const handler = handlers[action];
    if (!handler || pendingAction) {
      return;
    }

    setPendingAction(action);
    try {
      const result = await handler(viewModel.activityId);
      if (isErrorResult(result)) {
        showAppDialog({ title: '一起听', message: result.message });
      }
    } catch (error) {
      showAppDialog({ title: '一起听', message: error instanceof Error ? error.message : '一起听操作失败' });
    } finally {
      setPendingAction(null);
    }
  }, [handlers, pendingAction, viewModel.activityId]);

  const card = (
    <ThemedSurface
      variant="card"
      backgroundColor={isPaperNote ? 'transparent' : theme.colors.surface.muted}
      style={styles.card}
    >
      <View style={styles.header}>
        <Headphones
          size={19}
          strokeWidth={1.8}
          color={theme.colors.brand.primary}
          style={styles.icon}
        />
        <Text style={styles.title}>{viewModel.title.replace(/^🎧\s*/, '')}</Text>
      </View>
      <Text style={styles.body}>{viewModel.body}</Text>
      {viewModel.durationText ? (
        <Text style={styles.duration}>{`一起听时长 ${viewModel.durationText}`}</Text>
      ) : null}
      {viewModel.actions.length > 0 ? (
        <View style={styles.actions}>
          {viewModel.actions.map((action) => {
            const isPrimary = action === 'accept';
            const isDisabled = pendingAction !== null || !handlers[action];
            return (
              <TouchableOpacity
                key={action}
                style={[
                  styles.action,
                  isPrimary && styles.actionPrimary,
                  isDisabled && styles.actionDisabled,
                ]}
                onPress={() => { void handleAction(action); }}
                disabled={isDisabled}
                activeOpacity={0.75}
              >
                <Text style={[styles.actionText, isPrimary && styles.actionPrimaryText]}>
                  {pendingAction === action ? '处理中…' : ACTION_LABELS[action]}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </ThemedSurface>
  );

  if (isPaperNote) {
    return (
      <PaperNoteMessageFrame speakerName={identity.name?.trim() || (identity.role === 'user' ? '用户' : 'AI')}>
        {card}
      </PaperNoteMessageFrame>
    );
  }

  return (
    <View style={styles.wrapper}>
      <View style={[styles.row, viewModel.isMe && styles.rowMe]}>
        {shouldShowAvatar && identity.role === 'ai' ? (
          <Avatar
            avatarContent={identity.avatarContent}
            isUser={false}
            aiName={identity.name || undefined}
          />
        ) : null}
        {card}
        {shouldShowAvatar && identity.role === 'user' ? (
          <Avatar
            avatarContent={identity.avatarContent}
            isUser
            userName={identity.name || undefined}
          />
        ) : null}
      </View>
    </View>
  );
}

export default memo(TogetherListeningActivityCard);
