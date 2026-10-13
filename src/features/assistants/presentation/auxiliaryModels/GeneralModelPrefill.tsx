/** 创建表单按需读取可用通用模型，只将值快照交给表单 owner。 */
import React, { useState } from 'react';
import { Text } from 'react-native';
import { Button, ModelPickerModal } from '@shared/ui';
import { useTheme } from '@shared/theme';
import type { ModelCallConfig } from '../../domain/ModelCallConfig';
import { getAuxiliaryModelSelection } from '../../ResolveAuxiliaryModel';
import { getGeneralModelCopy } from '../../GeneralModelCopies';

export default function GeneralModelPrefill({ onFill, disabled = false }: { onFill(config: ModelCallConfig): void; disabled?: boolean }) {
  const theme = useTheme();
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState<ModelCallConfig | null>(null);
  const open = async () => {
    setLoading(true); setError(null);
    try {
      const settings = await getAuxiliaryModelSelection({ modelConfigId: null, capabilityKind: 'general' });
      setModels(settings.models.map((model) => ({ id: model.id, name: `${model.name} · ${model.model}` })));
      setVisible(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '读取通用模型失败。'); }
    finally { setLoading(false); }
  };
  const select = async (id: string) => {
    setVisible(false); setLoading(true); setError(null);
    try {
      const config = await getGeneralModelCopy(id);
      onFill(config);
      setFilled(config);
    }
    catch (failure) { setError(failure instanceof Error ? failure.message : '填入失败。'); }
    finally { setLoading(false); }
  };
  return <>
    <Button title={loading ? '读取中…' : '从通用辅助模型填入'} variant="outline" disabled={disabled || loading} onPress={() => void open()} />
    <Text style={{ color: theme.colors.text.secondary, fontSize: 13, marginVertical: theme.spacing.sm }}>填入连接与模型参数，创建后独立保存，后续修改互不影响。</Text>
    {filled ? <Text style={{ color: theme.colors.text.secondary, fontSize: 13, marginBottom: theme.spacing.sm }}>
      初始参数：Temperature {filled.temperature ?? '服务商默认'} · Top P {filled.topP ?? '服务商默认'} · Max Tokens {filled.maxTokens ?? '无限制'}
    </Text> : null}
    {error ? <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error }}>{error}</Text> : null}
    <ModelPickerModal visible={visible} models={models} onSelect={(id) => void select(id)} onClose={() => setVisible(false)}
      title="填入通用辅助模型" emptyText="暂无可用通用模型，请先在辅助模型中心新增或完善配置。" />
  </>;
}
