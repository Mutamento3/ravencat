/**
 * 群聊发言队列浮层：只投影持久化的 plan/task 状态（打开期间轮询
 * getGroupSpeechQueue），不维护任何进程内队列副本；点击浮层外部关闭。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { ThemedSurface, useTheme } from '@shared/theme';
import { AIAvatar } from '@shared/ui';
import { getGroupSpeechQueue } from '../../group/application';
import type {
  GroupSpeechPlan,
  GroupSpeechTask,
  GroupSpeechTaskStatus,
} from '../../group/domain/GroupChat';
import type { GroupParticipantDirectory } from '../../group/domain/GroupParticipantDirectory';

const QUEUE_POLL_INTERVAL_MS = 1000;

interface GroupSpeechQueueOverlayProps {
  visible: boolean;
  groupId: string;
  participantDirectory: GroupParticipantDirectory | null;
  onClose: () => void;
  /** 轮询期间同步 active plan 事实，供控制区按钮保持与持久状态一致。 */
  onActivePlanChange: (plan: GroupSpeechPlan | null) => void;
}

export default function GroupSpeechQueueOverlay({
  visible,
  groupId,
  participantDirectory,
  onClose,
  onActivePlanChange,
}: GroupSpeechQueueOverlayProps) {
  const theme = useTheme();
  const [plan, setPlan] = useState<GroupSpeechPlan | null>(null);
  const [tasks, setTasks] = useState<GroupSpeechTask[]>([]);

  const refresh = useCallback(async () => {
    const snapshot = await getGroupSpeechQueue(groupId);
    setPlan(snapshot.plan);
    setTasks(snapshot.tasks);
    onActivePlanChange(snapshot.activePlan);
  }, [groupId, onActivePlanChange]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    let cancelled = false;
    const poll = async () => {
      try {
        if (!cancelled) {
          await refresh();
        }
      } catch (error) {
        console.error('[GroupSpeechQueueOverlay] Failed to load speech queue:', error);
      }
    };
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, QUEUE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [refresh, visible]);

  const participantByAssistantId = useMemo(() => {
    return new Map(
      (participantDirectory?.assistants || []).map((participant) => [
        participant.assistantId,
        participant,
      ]),
    );
  }, [participantDirectory]);

  // 已有输出但未完成用警告色，避免与完全没有回复的失败混淆。
  // 其余终态（已跳过/已换代/已终止）不属于进行中队列，用次级灰显示。
  const statusPresentation = useMemo<Record<GroupSpeechTaskStatus, { label: string; color: string }>>(() => ({
    queued: { label: '排队中', color: theme.colors.feedback.warning },
    running: { label: '回复中', color: theme.colors.brand.primary },
    completed: { label: '已完成', color: theme.colors.feedback.success },
    partial: { label: '部分回复', color: theme.colors.feedback.warning },
    failed: { label: '失败', color: theme.colors.feedback.error },
    skipped: { label: '已跳过', color: theme.colors.text.secondary },
    superseded: { label: '已换代', color: theme.colors.text.secondary },
    terminated: { label: '已终止', color: theme.colors.text.secondary },
  }), [theme]);

  const styles = useMemo(() => StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.25)',
      justifyContent: 'flex-end',
    },
    panel: {
      marginHorizontal: theme.spacing.md,
      marginBottom: 96,
      maxHeight: 320,
      overflow: 'hidden',
      borderRadius: theme.radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.light,
      paddingVertical: theme.spacing.sm,
    },
    header: {
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 6,
    },
    headerText: {
      color: theme.colors.text.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    taskList: {
      flexGrow: 0,
      flexShrink: 1,
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 40,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 4,
      gap: theme.spacing.sm,
    },
    taskContent: {
      flex: 1,
    },
    taskName: {
      color: theme.colors.text.primary,
      fontSize: 14,
    },
    taskDetail: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      marginTop: 3,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '600',
    },
    emptyText: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      textAlign: 'center',
      paddingVertical: theme.spacing.md,
    },
  }), [theme]);

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* 关闭遮罩与面板平级，避免点击响应器参与列表的滚动手势。 */}
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel="关闭发言队列"
          onPress={onClose}
        />
        {/* 队列覆盖聊天消息，玻璃主题需要独立材质，不能沿用透明页面底色。 */}
        <ThemedSurface
          variant="modal"
          cornerRadius={theme.radius.lg}
          backgroundColor={theme.colors.background.app}
          style={styles.panel}
        >
          <View style={styles.header}>
            <Ionicons name="list" size={16} color={theme.colors.text.primary} />
            <Text style={styles.headerText}>发言队列</Text>
          </View>
          {tasks.length === 0 ? (
            <Text style={styles.emptyText}>
              {plan ? '暂无发言任务' : '当前没有发言计划'}
            </Text>
          ) : (
            <ScrollView style={styles.taskList}>
              {tasks.map((task) => {
                const participant = participantByAssistantId.get(task.aiAssistantId);
                // 历史失败或进程中断也可能已有正文，展示必须尊重持久提交事实。
                const status = statusPresentation[
                  task.status === 'failed' && task.visibleReplyCommitted ? 'partial' : task.status
                ];
                return (
                  <View key={task.id} style={styles.taskRow}>
                    <AIAvatar
                      name={participant?.nickname ?? participant?.displayName ?? 'AI'}
                      avatarUrl={participant?.avatar ?? null}
                      size="small"
                    />
                    <View style={styles.taskContent}>
                      <Text style={styles.taskName} numberOfLines={1}>
                        {participant?.nickname ?? participant?.displayName ?? 'AI'}
                      </Text>
                      {task.errorMessage ? (
                        <Text style={styles.taskDetail}>{task.errorMessage}</Text>
                      ) : null}
                    </View>
                    <Text style={[styles.statusText, { color: status.color }]}>
                      {status.label}
                    </Text>
                  </View>
                );
              })}
            </ScrollView>
          )}
        </ThemedSurface>
      </View>
    </Modal>
  );
}
