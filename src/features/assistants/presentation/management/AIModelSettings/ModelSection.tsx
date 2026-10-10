// 模型选择 + 测试连接区块

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useTheme, useThemedStyles } from '@shared/theme';
import { Button } from '@shared/ui';
import { createModelSettingsStyles } from './styles';

interface ModelSectionProps {
  selectedModel: string;
  hasAvailableModels: boolean;
  isLoadingModels: boolean;
  testResult: 'success' | 'error' | 'param_error' | null;
  isTesting: boolean;
  onFetchModels: () => void;
  onShowPicker: () => void;
  onTestConnection: () => void;
}

export default function ModelSection({
  selectedModel,
  hasAvailableModels,
  isLoadingModels,
  testResult,
  isTesting,
  onFetchModels,
  onShowPicker,
  onTestConnection,
}: ModelSectionProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createModelSettingsStyles);

  const getButtonText = () => {
    if (testResult === 'success') return '连接正常';
    if (testResult === 'error') return '连接失败';
    if (testResult === 'param_error') return '参数错误';
    return '测试连接';
  };

  const testVariant = testResult === 'error' || testResult === 'param_error' ? 'danger' : 'primary';

  return (
    <View style={styles.section}>
      <View style={styles.modelSectionHeader}>
        <Text style={styles.sectionLabel}>模型</Text>
        <TouchableOpacity
          style={[styles.miniBtn, styles.miniBtnPrimary]}
          onPress={onFetchModels}
          disabled={isLoadingModels}
          activeOpacity={0.7}
        >
          {isLoadingModels ? (
            <ActivityIndicator size="small" color={theme.colors.brand.primary} />
          ) : (
            <Text style={styles.miniBtnText}>
              {hasAvailableModels ? '重新获取' : '获取模型列表'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {selectedModel ? (
        <View style={[styles.modelValueBox, styles.modelValueBoxHighlight]}>
          <Text
            style={[styles.modelValueText, styles.modelValueTextHighlight]}
            numberOfLines={1}
            ellipsizeMode="middle"
          >
            {selectedModel}
          </Text>
          {hasAvailableModels && (
            <TouchableOpacity
              style={[styles.miniBtn, { backgroundColor: theme.colors.surface.input, alignSelf: 'center' }]}
              onPress={onShowPicker}
              activeOpacity={0.7}
            >
              <Text style={styles.miniBtnText}>切换</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <View style={[styles.modelValueBox, styles.modelValueBoxMuted]}>
          <Text style={[styles.modelValueText, styles.modelValueTextMuted]}>未选择模型</Text>
        </View>
      )}

      {selectedModel && (
        <Button
          title={getButtonText()}
          onPress={onTestConnection}
          disabled={isTesting}
          variant={testVariant}
          style={{ width: '100%' }}
        />
      )}
    </View>
  );
}
