import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import { InputField, Button } from '@shared/ui';
import { useTheme, useThemedStyles } from '@shared/theme';
import { createCommonStyles } from '@shared/ui/commonStyles';
import { createStyles } from './styles';

function useAddAIStyles() {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const commonStyles = React.useMemo(() => createCommonStyles(theme), [theme]);
  return { styles, commonStyles };
}

interface NameInputProps {
  value: string;
  onChangeText: (text: string) => void;
}

export function NameInput({ value, onChangeText }: NameInputProps) {
  const { styles } = useAddAIStyles();
  return (
    <View style={styles.section}>
      <InputField
        label="AI名称 *"
        value={value}
        onChangeText={onChangeText}
        placeholder="如：我的ai助手"
        maxLength={20}
        style={{ marginBottom: 0 }}
      />
    </View>
  );
}

interface ApiUrlInputProps {
  value: string;
  onChangeText: (text: string) => void;
}

export function ApiUrlInput({ value, onChangeText }: ApiUrlInputProps) {
  const { styles } = useAddAIStyles();
  return (
    <View style={styles.section}>
      <InputField
        label="API 地址 *"
        value={value}
        onChangeText={onChangeText}
        placeholder="https://api.example.cn/v1"
        hint="OpenAI 兼容格式的 API 地址"
        autoGrow
        style={{ marginBottom: 0 }}
      />
    </View>
  );
}

interface ApiKeyInputProps {
  value: string;
  onChangeText: (text: string) => void;
}

export function ApiKeyInput({ value, onChangeText }: ApiKeyInputProps) {
  const { styles } = useAddAIStyles();
  return (
    <View style={styles.section}>
      <InputField
        label="API Key *"
        value={value}
        onChangeText={onChangeText}
        placeholder="sk-..."
        autoGrow
        autoCapitalize="none"
        style={{ marginBottom: 0 }}
      />
    </View>
  );
}

interface FetchModelsButtonProps {
  onPress: () => void;
  isLoading: boolean;
  hasModels: boolean;
}

export function FetchModelsButton({ onPress, isLoading, hasModels }: FetchModelsButtonProps) {
  const { styles } = useAddAIStyles();
  return (
    <View style={styles.section}>
      <Button
        title={hasModels ? '重新获取模型列表' : '获取模型列表'}
        onPress={onPress}
        disabled={isLoading}
        style={{ width: '100%' }}
      />
    </View>
  );
}

interface SelectedModelProps {
  modelId: string;
  onChangePress: () => void;
}

export function SelectedModel({ modelId, onChangePress }: SelectedModelProps) {
  const { styles, commonStyles } = useAddAIStyles();
  return (
    <View style={styles.section}>
      <Text style={commonStyles.label}>已选择模型</Text>
      <View style={styles.selectedModelContainer}>
        <Text style={styles.selectedModelText} numberOfLines={1}>{modelId}</Text>
        <TouchableOpacity
          style={styles.changeModelBtn}
          onPress={onChangePress}
          activeOpacity={0.7}
        >
          <Text style={styles.changeModelText}>更换</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function ModelSelectHint() {
  const { styles, commonStyles } = useAddAIStyles();
  return (
    <View style={styles.section}>
      <Text style={commonStyles.label}>点击上方按钮选择模型</Text>
    </View>
  );
}

interface TestConnectionButtonProps {
  onPress: () => void;
  isTesting: boolean;
  testResult: 'success' | 'error' | null;
}

export function TestConnectionButton({ onPress, isTesting, testResult }: TestConnectionButtonProps) {
  const { styles } = useAddAIStyles();
  const getButtonText = () => {
    if (testResult === 'success') return '连接正常';
    if (testResult === 'error') return '连接失败';
    return '测试连接';
  };

  const variant = testResult === 'error' ? 'danger' : 'primary';

  return (
    <View style={styles.section}>
      <Button
        title={getButtonText()}
        onPress={onPress}
        disabled={isTesting}
        variant={variant}
        style={{ width: '100%' }}
      />
    </View>
  );
}

interface SystemPromptInputProps {
  value: string;
  onChangeText: (text: string) => void;
}

export function SystemPromptInput({ value, onChangeText }: SystemPromptInputProps) {
  const { styles } = useAddAIStyles();
  return (
    <View style={styles.section}>
      <InputField
        label="系统提示词"
        value={value}
        onChangeText={onChangeText}
        placeholder="可选：为这个 AI 设置默认人设、语气或行为规则"
        hint="留空则使用模型默认行为"
        multiline
        style={{ marginBottom: 0 }}
      />
    </View>
  );
}

export function TipSection() {
  const { commonStyles } = useAddAIStyles();
  return (
    <View style={commonStyles.emptyContainer}>
      <Text style={commonStyles.emptyText}>
        建议先填写 API 地址和 API Key，再获取模型列表并测试连接，确认无误后保存。
      </Text>
    </View>
  );
}
