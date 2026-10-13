/** Wallet settings sheet for selecting the ledger assistant. */
import { getAssistantDisplayName } from '@features/assistants';
// 设置弹窗（记账AI选择）

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';
import { AIAvatar, ModalSheet } from '@shared/ui';
import type { AIProfile } from '@features/assistants';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  aiList: AIProfile[];
  ledgerAI: AIProfile | null;
  onSetLedgerAI: (aiId: string | null) => void;
}

const createStyles = (theme: PresentationTheme) =>
  StyleSheet.create({
    content: {
      backgroundColor: theme.colors.background.app,
      padding: theme.spacing.xl,
      flexShrink: 1,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: theme.spacing.xl,
    },
    close: {
      fontSize: 15,
      color: theme.colors.text.secondary,
    },
    title: {
      fontSize: 17,
      fontWeight: '600',
      color: theme.colors.text.primary,
    },
    save: {
      fontSize: 15,
      color: theme.colors.text.link,
      fontWeight: '600',
    },
    desc: {
      fontSize: 13,
      color: theme.colors.text.secondary,
      marginBottom: theme.spacing.lg,
    },
    aiOption: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderRadius: theme.radius.md,
      backgroundColor: theme.colors.surface.muted,
      marginBottom: theme.spacing.sm,
    },
    aiOptionActive: {
      backgroundColor: theme.colors.brand.primary,
    },
    aiAvatar: {
      marginRight: 10,
    },
    aiText: {
      flex: 1,
      fontSize: 15,
      color: theme.colors.text.primary,
    },
    aiTextActive: {
      color: theme.colors.brand.onPrimary,
      fontWeight: '500',
    },
    check: {
      fontSize: 16,
      color: theme.colors.brand.onPrimary,
      fontWeight: '600',
    },
    aiList: {
      flexShrink: 1,
    },
  });

const SettingsModal: React.FC<SettingsModalProps> = ({
  visible,
  onClose,
  aiList,
  ledgerAI,
  onSetLedgerAI,
}) => {
  const styles = useThemedStyles(createStyles);

  // 临时选中的AI ID
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 弹窗打开时，初始化选中状态
  useEffect(() => {
    if (visible) {
      setSelectedId(ledgerAI?.id || null);
    }
  }, [visible, ledgerAI]);

  const handleSave = () => {
    onSetLedgerAI(selectedId);
    onClose();
  };

  return (
    <ModalSheet visible={visible} onClose={onClose}>
      <View style={styles.content}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose}>
              <Text style={styles.close}>取消</Text>
            </TouchableOpacity>
            <Text style={styles.title}>记账AI助手</Text>
            <TouchableOpacity onPress={handleSave}>
              <Text style={styles.save}>保存</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.desc}>选中的AI会在记账后主动发送消息</Text>

          {/* 操作栏保持可见，长 AI 列表在弹窗的剩余高度内滚动。 */}
          <ScrollView style={styles.aiList} keyboardShouldPersistTaps="handled">
            <TouchableOpacity
              style={[styles.aiOption, !selectedId && styles.aiOptionActive]}
              onPress={() => setSelectedId(null)}
              accessibilityRole="radio"
              accessibilityState={{ checked: !selectedId }}
            >
              <Text style={[styles.aiText, !selectedId && styles.aiTextActive]}>不启用</Text>
              {!selectedId && <Text style={styles.check}>✓</Text>}
            </TouchableOpacity>

            {aiList.map((ai) => (
              <TouchableOpacity
                key={ai.id}
                style={[styles.aiOption, selectedId === ai.id && styles.aiOptionActive]}
                onPress={() => setSelectedId(ai.id)}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedId === ai.id }}
              >
                <AIAvatar
                  name={getAssistantDisplayName(ai)}
                  avatarUrl={ai.avatar}
                  size="small"
                  style={styles.aiAvatar}
                />
                <Text style={[styles.aiText, selectedId === ai.id && styles.aiTextActive]}>
                  {getAssistantDisplayName(ai)}
                </Text>
                {selectedId === ai.id && <Text style={styles.check}>✓</Text>}
              </TouchableOpacity>
            ))}
          </ScrollView>
      </View>
    </ModalSheet>
  );
};

export default SettingsModal;
