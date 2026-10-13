/** 先固定当前合法草稿，再独立命名创建资产，不等待原配置保存。 */
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, InputField, ModalSheet, showAppDialog } from '@shared/ui';
import { useTheme } from '@shared/theme';
import type { ModelCallConfig } from '../../domain/ModelCallConfig';
import { createAuxiliaryModelConfig } from '../../ManageAuxiliaryModelConfigs';
import { buildGeneralModelCopy } from '../../GeneralModelCopies';

export default function CopyToGeneralModel({ readConfig }: { readConfig(): ModelCallConfig | null }) {
  const theme = useTheme();
  const [config, setConfig] = useState<ModelCallConfig | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = () => {
    const snapshot = readConfig();
    if (!snapshot) return;
    if (!snapshot.apiBaseUrl || !snapshot.apiKey || !snapshot.model) {
      showAppDialog({ title: '无法复制', message: '请先填写 API 地址、API Key，并选择模型。', tone: 'warning' });
      return;
    }
    setConfig(snapshot); setName(''); setError(null);
  };
  const create = async () => {
    if (saving || !config) return;
    if (!name.trim()) { setError('请填写配置名称。'); return; }
    setSaving(true); setError(null);
    try {
      await createAuxiliaryModelConfig(buildGeneralModelCopy(name.trim(), config));
      setConfig(null);
      showAppDialog({ title: '已加入通用辅助模型', message: '副本已创建，双方后续修改互不影响。', tone: 'success' });
    } catch (failure) { setError(failure instanceof Error ? failure.message : '创建失败，输入已保留。'); }
    finally { setSaving(false); }
  };
  return <>
    <Button title="加入通用辅助模型" variant="outline" onPress={open} />
    <ModalSheet visible={config !== null} onClose={() => { if (!saving) setConfig(null); }} title="加入通用辅助模型" avoidKeyboard>
      <View style={{ padding: theme.spacing.lg, gap: theme.spacing.md }}>
        <Text style={{ color: theme.colors.text.secondary }}>复制当前连接、模型、Temperature、Top P 和 Max Tokens。角色资料与工具权限不复制。</Text>
        <InputField label="配置名称" placeholder="为独立副本填写名称" value={name} onChangeText={setName} />
        {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error }}>{error}</Text> : null}
        <Button title={saving ? '创建中…' : '创建副本'} disabled={saving} onPress={() => void create()} />
      </View>
    </ModalSheet>
  </>;
}
