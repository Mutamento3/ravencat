/**
 * 群聊发言队列浮层：只投影持久化的 plan/task 状态（打开期间轮询
 * getGroupSpeechQueue），不维护任何进程内队列副本；点击浮层外部关闭。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '@shared/theme';
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

  // 四色任务状态：completed 绿、running 枫渡蓝、queued 黄、failed 红；
  // 其余终态（已跳过/已换代/已终止）不属于进行中队列，用次级灰显示。
  const statusPresentation = useMemo<Record<GroupSpeechTaskStatus, { label: string; color: string }>>(() => ({
    queued: { label: '排队中', color: theme.colors.feedback.warning },
    running: { label: '回复中', color: theme.colors.brand.primary },
    completed: { label: '已完成', color: theme.colors.feedback.success },
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
      borderRadius: theme.radius.lg,
      backgroundColor: theme.colors.background.app,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border.light,
      paddingVertical: theme.spacing.sm,
    },
    header: {
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
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 40,
      paddingHorizontal: theme.spacing.md,
      paddingVertical: 4,
      gap: theme.spacing.sm,
    },
    taskName: {
      flex: 1,
      color: theme.colors.text.primary,
      fontSize: 14,
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
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop}>
          <TouchableWithoutFeedback>
            <View style={styles.panel}>
              <View style={styles.header}>
                <Ionicons name="list" size={16} color={theme.colors.text.primary} />
                <Text style={styles.headerText}>发言队列</Text>
              </View>
              {tasks.length === 0 ? (
                <Text style={styles.emptyText}>
                  {plan ? '暂无发言任务' : '当前没有发言计划'}
                </Text>
              ) : (
                tasks.map((task) => {
                  const participant = participantByAssistantId.get(task.aiAssistantId);
                  const status = statusPresentation[task.status];
                  return (
                    <View key={task.id} style={styles.taskRow}>
                      <AIAvatar
                        name={participant?.displayName || 'AI'}
                        avatarUrl={participant?.avatar ?? null}
                        size="small"
                      />
                      <Text style={styles.taskName} numberOfLines={1}>
                        {participant?.displayName || 'AI'}
                      </Text>
                      <Text style={[styles.statusText, { color: status.color }]}>
                        {status.label}
                      </Text>
                    </View>
                  );
                })
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
