/**
 * 发布页「谁可以看」选择器。
 *
 * 只负责选择稳定 agentId 并产出 draft；把 draft 收敛成 canonical `MomentAudience` 的规则
 * 在 `MomentAudienceDraft.ts`（纯函数），真值仍在 Application / Repository。
 *
 * 用户选择后如果某个 AI 已被删除，Application 会以 `unknown_audience_agent_id` 拒绝发布；
 * 这里不做「按名字重新猜一个 agentId」的兜底。
 *
 * 弹窗容器统一走 shared `ModalSheet`（动画 / 遮罩 / 玻璃质感 / 圆角与其他底部弹窗一致）。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useTheme } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import { Button, ModalSheet, UserAvatar } from '@shared/ui';
import type { MomentAudienceMode } from '../domain/MomentRepository';
import {
  MOMENT_AUDIENCE_MODE_LABELS,
  canonicalizeMomentAudienceDraft,
  isMomentAudienceDraftSubmittable,
  selectMomentAudienceMode,
  toggleMomentAudienceCandidate,
  type MomentAudienceCandidate,
  type MomentAudienceDraft,
} from './MomentAudienceDraft';

const MODE_ORDER: readonly MomentAudienceMode[] = ['all', 'selected', 'all_except'];

interface MomentAudienceSelectorModalProps {
  visible: boolean;
  draft: MomentAudienceDraft;
  candidates: readonly MomentAudienceCandidate[];
  candidatesLoading: boolean;
  /** 确认时回传新 draft；取消不产生任何变更。 */
  onConfirm: (draft: MomentAudienceDraft) => void;
  onCancel: () => void;
}

function createStyles(theme: PresentationTheme) {
  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.md,
      borderBottomWidth: 0.5,
      borderBottomColor: theme.colors.border.light,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    modeRow: {
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.md,
      gap: theme.spacing.sm,
    },
    modeOption: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: theme.spacing.md,
      paddingHorizontal: theme.spacing.md,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface.muted,
    },
    modeOptionActive: {
      backgroundColor: theme.colors.surface.default,
      borderWidth: 1,
      borderColor: theme.colors.brand.primary,
    },
    modeText: {
      fontSize: 15,
      color: theme.colors.text.primary,
    },
    modeTextActive: {
      color: theme.colors.brand.primary,
      fontWeight: '600',
    },
    candidateSectionTitle: {
      fontSize: 13,
      color: theme.colors.text.secondary,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
      paddingBottom: theme.spacing.sm,
    },
    candidateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingVertical: theme.spacing.md,
    },
    candidateName: {
      flex: 1,
      fontSize: 15,
      color: theme.colors.text.primary,
    },
    checkbox: {
      width: 22,
      height: 22,
      borderRadius: 11,
      borderWidth: 1.5,
      borderColor: theme.colors.border.default,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      borderColor: theme.colors.brand.primary,
      backgroundColor: theme.colors.brand.primary,
    },
    checkboxMark: {
      color: theme.colors.brand.onPrimary,
      fontSize: 13,
      lineHeight: 16,
      fontWeight: '700',
    },
    emptyText: {
      fontSize: 14,
      color: theme.colors.text.secondary,
      textAlign: 'center',
      paddingVertical: theme.spacing.xl,
    },
    hintText: {
      fontSize: 12,
      color: theme.colors.text.tertiary,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.sm,
    },
    footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: theme.spacing.md,
      paddingHorizontal: theme.spacing.lg,
      paddingTop: theme.spacing.lg,
    },
  });
}

export default function MomentAudienceSelectorModal({
  visible,
  draft: initialDraft,
  candidates,
  candidatesLoading,
  onConfirm,
  onCancel,
}: MomentAudienceSelectorModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [draft, setDraft] = useState<MomentAudienceDraft>(initialDraft);

  // 每次打开都以发布页当前的 draft 为起点，取消过的改动不会残留。
  useEffect(() => {
    if (visible) setDraft(initialDraft);
  }, [visible, initialDraft]);

  const handleSelectMode = useCallback((mode: MomentAudienceMode) => {
    setDraft((current) => selectMomentAudienceMode(mode, current));
  }, []);

  const handleToggle = useCallback((agentId: string) => {
    setDraft((current) => toggleMomentAudienceCandidate(current, agentId));
  }, []);

  const submittable = isMomentAudienceDraftSubmittable(draft);
  const showCandidates = draft.mode !== 'all';
  const selected = useMemo(() => new Set(draft.viewerAgentIds), [draft.viewerAgentIds]);

  return (
    <ModalSheet visible={visible} onClose={onCancel}>
      <View testID="moment-audience-selector">
        <View style={styles.header}>
          <Text style={styles.title}>谁可以看</Text>
          <TouchableOpacity onPress={onCancel} activeOpacity={0.7}>
            <Text style={styles.modeText}>取消</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.modeRow}>
          {MODE_ORDER.map((mode) => {
            const active = draft.mode === mode;
            return (
              <TouchableOpacity
                key={mode}
                style={[styles.modeOption, active && styles.modeOptionActive]}
                onPress={() => handleSelectMode(mode)}
                activeOpacity={0.7}
              >
                <Text style={[styles.modeText, active && styles.modeTextActive]}>
                  {MOMENT_AUDIENCE_MODE_LABELS[mode]}
                </Text>
                {active ? <Text style={styles.modeTextActive}>✓</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>

        {showCandidates ? (
          <>
            <Text style={styles.candidateSectionTitle}>
              {draft.mode === 'selected' ? '选择可以看到的 AI' : '选择不给哪些 AI 看'}
            </Text>
            {candidatesLoading ? (
              <ActivityIndicator style={styles.emptyText} color={theme.colors.brand.primary} />
            ) : (
              <FlatList
                data={candidates}
                keyExtractor={(item) => item.agentId}
                renderItem={({ item }) => {
                  const checked = selected.has(item.agentId);
                  return (
                    <TouchableOpacity
                      style={styles.candidateRow}
                      onPress={() => handleToggle(item.agentId)}
                      activeOpacity={0.7}
                    >
                      <UserAvatar name={item.displayName} avatarUrl={item.avatar} size="small" />
                      <Text style={styles.candidateName} numberOfLines={1}>{item.displayName}</Text>
                      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
                        {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                      </View>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={<Text style={styles.emptyText}>还没有可选择的 AI</Text>}
              />
            )}
          </>
        ) : (
          <Text style={styles.hintText}>所有 AI 都能看到这条时刻。</Text>
        )}

        {!submittable ? (
          <Text style={styles.hintText}>请至少选择一个 AI。</Text>
        ) : null}

        <View style={styles.footer}>
          <Button title="取消" variant="text" onPress={onCancel} />
          <Button
            title="确定"
            onPress={() => onConfirm(canonicalizeMomentAudienceDraft(draft))}
            disabled={!submittable}
          />
        </View>
      </View>
    </ModalSheet>
  );
}
