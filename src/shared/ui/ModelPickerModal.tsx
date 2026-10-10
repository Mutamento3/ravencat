/** 复用 ModalSheet 的通用模型选择弹窗。 */

import React from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import CheckIcon from './CheckIcon';
import ModalSheet from './ModalSheet';
import { useThemedStyles } from '@shared/theme';
import type { PresentationTheme } from '@shared/theme';

interface ModelItem {
  id: string;
  name: string;
}

export interface ModelPickerModalProps {
  visible: boolean;
  models: ModelItem[];
  selectedModel?: string;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  title?: string;
  emptyText?: string;
}

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  listContent: {
    paddingBottom: theme.spacing.lg,
  },
  modelItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 0.5,
    borderBottomColor: theme.colors.border.light,
  },
  modelItemSelected: {
    backgroundColor: theme.colors.brand.primary + '08',
  },
  modelItemText: {
    fontSize: 16,
    color: theme.colors.text.primary,
    flex: 1,
  },
  modelItemTextSelected: {
    color: theme.colors.brand.primary,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: theme.colors.text.tertiary,
  },
});

export default function ModelPickerModal({
  visible,
  models,
  selectedModel,
  onSelect,
  onClose,
  title = '选择模型',
  emptyText = '暂无可用模型',
}: ModelPickerModalProps) {
  const styles = useThemedStyles(createStyles);

  const renderModelItem = ({ item }: { item: ModelItem }) => (
    <TouchableOpacity
      style={[
        styles.modelItem,
        selectedModel === item.id && styles.modelItemSelected,
      ]}
      onPress={() => onSelect(item.id)}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles.modelItemText,
          selectedModel === item.id && styles.modelItemTextSelected,
        ]}
        numberOfLines={1}
      >
        {item.name}
      </Text>
      {selectedModel === item.id && <CheckIcon />}
    </TouchableOpacity>
  );

  return (
    <ModalSheet
      visible={visible}
      onClose={onClose}
      title={title}
      style={{ maxHeight: '70%', paddingBottom: 0 }}
    >
      <FlatList
        data={models}
        keyExtractor={(item) => item.id}
        renderItem={renderModelItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        }
      />
    </ModalSheet>
  );
}
