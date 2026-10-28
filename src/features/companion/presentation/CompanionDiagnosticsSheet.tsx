/** 手动读取和复制运行诊断，不轮询、不重建投影，也不触发 AI 执行。 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { copyTextToClipboard } from '@platform/device';
import { useTheme, useThemedStyles } from '@shared/theme';
import { Button, ModalSheet } from '@shared/ui';
import { getAIScheduleDiagnostics, getNativeHealth } from '../application/CompanionNativeFacade';
import { buildCompanionDiagnosticsReport } from './CompanionDiagnosticsReport';
import { createStyles } from './CompanionDiagnosticsSheet.styles';

export function CompanionDiagnosticsSheet({ onClose }: { onClose: () => void }) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.all([getNativeHealth(), getAIScheduleDiagnostics()]).then(([health, diagnostics]) => {
      const nextReport = buildCompanionDiagnosticsReport(health, diagnostics, new Date());
      if (active) setReport(nextReport);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : '无法读取日程运行诊断。');
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [revision]);

  return <ModalSheet visible onClose={onClose} title="日程运行诊断">
    <View style={styles.actions}>
      <Button title="刷新" variant="secondary" disabled={busy} onPress={() => {
        setBusy(true); setError(null); setReport(null); setCopied(false); setRevision(value => value + 1);
      }} />
      <Button title={copied ? '已复制' : '复制诊断'} disabled={busy || report === null} onPress={() => {
        copyTextToClipboard(report!); setCopied(true);
      }} />
    </View>
    {busy ? <ActivityIndicator color={theme.colors.brand.primary} /> : null}
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      {report ? <Text selectable style={styles.report}>{report}</Text> : null}
    </ScrollView>
  </ModalSheet>;
}
