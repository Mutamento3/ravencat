import { useMemo } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import { useTheme } from '@shared/theme';
import { createBackupRestoreModalStyles } from './BackupRestoreModal.styles';

interface BackupRestoreModalProps {
  fileName: string | null;
  isRestoring: boolean;
  onCancel: () => void;
  onRestore: () => void;
}

export function BackupRestoreModal({
  fileName,
  isRestoring,
  onCancel,
  onRestore,
}: BackupRestoreModalProps) {
  const theme = useTheme();
  const styles = useMemo(() => createBackupRestoreModalStyles(theme), [theme]);

  const close = () => {
    if (isRestoring) return;
    onCancel();
  };

  return (
    <Modal visible={fileName !== null} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>从备份完全恢复</Text>
          <Text style={styles.fileName} numberOfLines={2}>{fileName}</Text>
          <Text style={styles.warning}>
            当前数据库、图片、文件和设置将被替换。恢复期间会临时保留原数据，成功后自动清理，失败则回滚。应用将退出，请再次打开应用完成恢复。
          </Text>
          <View style={styles.actionRow}>
            <Pressable
              style={[styles.button, styles.cancelButton]}
              onPress={close}
              disabled={isRestoring}
            >
              <Text style={styles.cancelText}>取消</Text>
            </Pressable>
            <Pressable
              style={[
                styles.button,
                styles.restoreButton,
                isRestoring && styles.disabled,
              ]}
              onPress={onRestore}
              disabled={isRestoring}
            >
              {isRestoring ? (
                <ActivityIndicator color={theme.colors.text.inverse} />
              ) : (
                <Text style={styles.restoreText}>恢复并退出</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
