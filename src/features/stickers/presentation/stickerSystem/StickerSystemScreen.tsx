/** 表情包系统稳定页面外壳与首页：安全区、导航栏和内部返回层级由外壳拥有。 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { EmptyState, ListItem, ModalSheet, NavigationHeader, showAppDialog } from '@shared/ui';
import { useTheme } from '@shared/theme';
import {
  getStickerSystemConfig,
  getStickerSystemModelSelection,
  listStickerModelCandidates,
  setStickerEmbeddingModel,
  setStickerRecognitionModel,
  type StickerSystemModelSelection,
} from '../../application/StickerSystemModels';
import {
  backfillMissingStickerEmbeddings,
  getStickerEmbeddingIndexStatus,
  rebuildStickerEmbeddingIndex,
} from '../../application/StickerEmbeddings';
import type {
  StickerEmbeddingIndexStatus,
} from '../../domain/StickerEmbedding';
import type {
  StickerModelConfigRef,
  StickerModelSelection,
  StickerSystemConfig,
} from '../../domain/StickerSystemConfig';
import { useStickerSystemStyles } from './styles';
import StickerSystemGroupsScreen from './StickerSystemGroupsScreen';
import StickerSystemLibraryScreen from './StickerSystemLibraryScreen';

type PickerKind = 'recognition' | 'embedding';

type StickerSystemView = 'system' | 'library' | 'groups';

interface StickerSystemHomeScreenProps {
  onOpenLibrary: () => void;
  onOpenGroups: () => void;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 绑定模型的副标题。展示状态来自 application query，与 picker candidate list 无关：
 * 只有当前模型确实存在、enabled 且 capability 匹配时才显示真实模型名称，
 * 其余失效原因（disabled / deleted / capability 不匹配）统一显示不可用。
 */
function modelSelectionSubtitle(
  selection: StickerModelSelection | null,
  unconfiguredText: string,
): string {
  if (!selection || selection.status === 'unconfigured') return unconfiguredText;
  if (selection.status === 'active' && selection.name) return selection.name;
  return '所选模型不可用';
}

export default function StickerSystemScreen({ onBack }: { onBack: () => void }) {
  const styles = useStickerSystemStyles();
  const [view, setView] = useState<StickerSystemView>('system');
  const returnToSystem = useCallback(() => setView('system'), []);

  useFocusEffect(useCallback(() => {
    if (view === 'system') return;
    // 内部视图不占导航栈记录；失焦后交还系统返回事件所有权。
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      returnToSystem();
      return true;
    });
    return () => subscription.remove();
  }, [returnToSystem, view]));

  const title = view === 'library' ? '全部表情包' : view === 'groups' ? '分组管理' : '表情包系统';

  // 内部切换只替换内容，保留原生安全区和导航栏，避免重新挂载时的布局跳动。
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <NavigationHeader
        title={title}
        onGoBack={view === 'system' ? onBack : returnToSystem}
        help={view === 'system' ? { sections: [
          { title: '选择模型', body: '模型在辅助模型中心统一管理，这里只选择表情包系统使用的模型。' },
        ] } : undefined}
      />
      {view === 'library' ? (
        <StickerSystemLibraryScreen />
      ) : view === 'groups' ? (
        <StickerSystemGroupsScreen />
      ) : (
        <StickerSystemHomeScreen
          onOpenLibrary={() => setView('library')}
          onOpenGroups={() => setView('groups')}
        />
      )}
    </SafeAreaView>
  );
}

function StickerSystemHomeScreen({
  onOpenLibrary,
  onOpenGroups,
}: StickerSystemHomeScreenProps) {
  const styles = useStickerSystemStyles();
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<StickerSystemConfig | null>(null);
  const [selection, setSelection] = useState<StickerSystemModelSelection | null>(null);
  const [status, setStatus] = useState<StickerEmbeddingIndexStatus | null>(null);
  const [pickerKind, setPickerKind] = useState<PickerKind | null>(null);
  const [candidates, setCandidates] = useState<StickerModelConfigRef[]>([]);
  const [working, setWorking] = useState(false);

  const reload = useCallback(async () => {
    const [nextConfig, nextStatus, nextSelection] = await Promise.all([
      getStickerSystemConfig(),
      getStickerEmbeddingIndexStatus(),
      getStickerSystemModelSelection(),
    ]);
    setConfig(nextConfig);
    setStatus(nextStatus);
    setSelection(nextSelection);
  }, []);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    reload().catch((error) => {
      showAppDialog({ title: '加载失败', message: getErrorMessage(error), tone: 'error' });
    }).finally(() => {
      if (mounted) setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [reload]);

  const openPicker = useCallback(async (kind: PickerKind) => {
    setPickerKind(kind);
    setCandidates([]);
    try {
      const models = await listStickerModelCandidates(kind === 'recognition' ? 'ocr' : 'embedding');
      setCandidates(models);
    } catch (error) {
      showAppDialog({ title: '加载失败', message: getErrorMessage(error), tone: 'error' });
    }
  }, []);

  const handleSelectModel = useCallback(async (modelConfigId: string | null) => {
    if (!pickerKind) return;
    setWorking(true);
    try {
      if (pickerKind === 'recognition') {
        await setStickerRecognitionModel(modelConfigId);
      } else {
        await setStickerEmbeddingModel(modelConfigId);
      }
      setPickerKind(null);
      await reload();
    } catch (error) {
      showAppDialog({ title: '保存失败', message: getErrorMessage(error), tone: 'error' });
    } finally {
      setWorking(false);
    }
  }, [pickerKind, reload]);

  const handleBackfill = useCallback(async () => {
    setWorking(true);
    try {
      await backfillMissingStickerEmbeddings();
      showAppDialog({ title: '已开始补齐索引', message: '将在前台空闲时自动为缺失向量建立语义索引。' });
    } finally {
      setWorking(false);
    }
  }, []);

  const handleRebuild = useCallback(async () => {
    showAppDialog({
      title: '重建全部索引',
      message: '将删除当前向量化模型的全部向量并重新生成，其他历史模型的向量保留。继续吗？',
      buttons: [
        { text: '取消', style: 'cancel' },
        {
          text: '重建',
          style: 'destructive',
          onPress: () => {
            setWorking(true);
            rebuildStickerEmbeddingIndex().then(() => {
              showAppDialog({ title: '已开始重建', message: '将在前台空闲时重新生成全部语义向量。' });
            }).catch((error) => {
              showAppDialog({ title: '重建失败', message: getErrorMessage(error), tone: 'error' });
            }).finally(() => {
              setWorking(false);
            });
          },
        },
      ],
    });
  }, []);

  // picker 的选中标记只看当前 picker 对应的那一个绑定，两个 picker 互不干扰。
  const boundModelConfigId = pickerKind === 'recognition'
    ? config?.recognitionModelConfigId
    : config?.embeddingModelConfigId;

  return (
    <View style={styles.container}>
      {loading ? (
        <ActivityIndicator style={{ marginTop: 80 }} size="large" />
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionTitle}>模型配置</Text>
          <View style={styles.card}>
            <ListItem
              title="视觉识别模型"
              subtitle={modelSelectionSubtitle(
                selection?.recognition ?? null,
                '未配置视觉识别模型',
              )}
              rightContent={<Ionicons name="chevron-forward" size={16} color={theme.colors.text.secondary} />}
              onPress={() => void openPicker('recognition')}
            />
            <ListItem
              title="向量化模型"
              subtitle={modelSelectionSubtitle(
                selection?.embedding ?? null,
                '未配置向量化模型，当前使用文本搜索',
              )}
              rightContent={<Ionicons name="chevron-forward" size={16} color={theme.colors.text.secondary} />}
              onPress={() => void openPicker('embedding')}
            />
          </View>

          <Text style={styles.sectionTitle}>语义索引</Text>
          <View style={styles.card}>
            <View style={[styles.statRow, styles.rowLast]}>
              <Text style={styles.statLabel}>可用表情包</Text>
              <Text style={styles.statValue}>{status?.readyStickers ?? 0}</Text>
            </View>
            <View style={[styles.statRow, styles.rowLast]}>
              <Text style={styles.statLabel}>有效索引</Text>
              <Text style={styles.statValue}>{status?.validEmbeddings ?? 0}</Text>
            </View>
            <View style={[styles.statRow, styles.rowLast]}>
              <Text style={styles.statLabel}>待建立</Text>
              <Text style={styles.statValue}>{status?.pendingEmbeddings ?? 0}</Text>
            </View>
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, working && styles.actionButtonDisabled]}
              disabled={working}
              onPress={() => void handleBackfill()}
            >
              <Text style={styles.actionButtonText}>补齐索引</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, working && styles.actionButtonDisabled]}
              disabled={working}
              onPress={() => void handleRebuild()}
            >
              <Text style={[styles.actionButtonText, styles.dangerActionText]}>重建全部索引</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.sectionTitle}>图库与分组</Text>
          <View style={styles.card}>
            <ListItem
              title="全部表情包"
              rightContent={<Ionicons name="chevron-forward" size={16} color={theme.colors.text.secondary} />}
              onPress={onOpenLibrary}
            />
            <ListItem
              title="分组管理"
              rightContent={<Ionicons name="chevron-forward" size={16} color={theme.colors.text.secondary} />}
              onPress={onOpenGroups}
            />
          </View>

          <View style={{ height: 32 }} />
        </ScrollView>
      )}

      <ModalSheet
        visible={pickerKind !== null}
        onClose={() => setPickerKind(null)}
        title={pickerKind === 'recognition' ? '选择视觉识别模型' : '选择向量化模型'}
      >
        {candidates.length === 0 ? (
          <EmptyState
            title="暂无可选模型"
            description={
              pickerKind === 'recognition'
                ? '请先到辅助模型中心创建并启用一个 ocr 类模型。'
                : '请先到辅助模型中心创建并启用一个 embedding 类模型。'
            }
          />
        ) : (
          <View>
            {candidates.map((model, index) => (
              <TouchableOpacity
                key={model.id}
                style={[styles.pickerItem, index === candidates.length - 1 && { borderBottomWidth: 0 }]}
                disabled={working}
                onPress={() => void handleSelectModel(model.id)}
              >
                <View>
                  <Text style={styles.rowTitle}>{model.name}</Text>
                  <Text style={styles.rowSubtitle}>{model.model}</Text>
                </View>
                {boundModelConfigId === model.id ? (
                  <Ionicons name="checkmark" size={20} />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ModalSheet>
    </View>
  );
}
