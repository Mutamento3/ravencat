import { useMemo } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { useTheme } from '@shared/theme';
import { Button, ModalSheet } from '@shared/ui';
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
    <ModalSheet visible={fileName !== null} title="从备份完全恢复" onClose={close}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.fileName} selectable>{fileName}</Text>
        <Text style={styles.warning}>当前数据库、图片、文件和设置将被替换。</Text>
        <Text style={styles.description}>
          恢复期间会临时保留原数据，成功后自动清理，失败则回滚。应用将退出，请再次打开应用完成恢复。
        </Text>
      </ScrollView>
      <View style={styles.actions}>
        {isRestoring && (
          <View style={styles.progress} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.colors.brand.primary} />
            <Text style={styles.progressText}>正在准备恢复，请勿关闭应用…</Text>
          </View>
        )}
        <Button
          title="恢复并退出"
          variant="danger"
          onPress={onRestore}
          disabled={isRestoring}
        />
        <Button title="取消" variant="secondary" onPress={close} disabled={isRestoring} />
      </View>
    </ModalSheet>
  );
}
