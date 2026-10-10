/** 渲染思维链卡片标题及展开/收起控制。 */

import React, { memo } from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { CollapseArrow } from './CollapseArrow';
import { useThemedStyles } from '@shared/theme';
import { createMessageBubbleStyles } from './styles';

interface ReasoningHeaderProps {
  isExpanded: boolean;
  onToggle: () => void;
  /**
   * 该展示项聚合的 reasoning step 数。1 或不传时不额外显示步骤数，
   * 保持与旧行为一致；> 1 时显示"· N 个步骤"，让用户知道这是聚合入口。
   */
  stepCount?: number;
}

export const ReasoningHeader = memo(function ReasoningHeader({
  isExpanded,
  onToggle,
  stepCount,
}: ReasoningHeaderProps) {
  const styles = useThemedStyles(createMessageBubbleStyles);
  const showStepCount = typeof stepCount === 'number' && stepCount > 1;

  return (
    <TouchableOpacity
      style={styles.reasoningHeader}
      onPress={onToggle}
      activeOpacity={0.7}
    >
      <Text style={styles.reasoningLabel}>
        {showStepCount ? `思维链 · ${stepCount} 个步骤` : '思维链'}
      </Text>
      <CollapseArrow isExpanded={isExpanded} styles={styles} />
    </TouchableOpacity>
  );
});
