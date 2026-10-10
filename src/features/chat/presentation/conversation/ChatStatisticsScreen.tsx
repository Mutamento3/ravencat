import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NavigationHeader } from '@shared/ui';
import { useTheme, useThemedStyles, type PresentationTheme } from '@shared/theme';
import { getChatStatistics } from '../../messages/application/ChatStatistics';
import { getEncounterDays, type ChatStatistics } from '../../messages/domain/ChatRecordStatistics';
import { setChatEventBus } from '../../messages/events/ChatEvents';

const createStyles = (theme: PresentationTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background.screen },
  content: { padding: theme.spacing.lg, gap: theme.spacing.md },
  encounter: { color: theme.colors.brand.primary, fontSize: 18, fontWeight: '600' },
  detail: { color: theme.colors.text.secondary, fontSize: 13, lineHeight: 20 },
  metrics: { flexDirection: 'row', gap: theme.spacing.md },
  metric: { backgroundColor: theme.colors.surface.muted, borderRadius: 12, padding: theme.spacing.md, gap: theme.spacing.xs },
  halfMetric: { flex: 1 },
  label: { color: theme.colors.text.secondary, fontSize: 13 },
  value: { color: theme.colors.text.primary, fontSize: 24, fontWeight: '600' },
  error: { color: theme.colors.feedback.error, fontSize: 14 },
  retry: { color: theme.colors.brand.primary, fontSize: 14 },
});

type StatisticsState =
  | { status: 'loading' }
  | { status: 'ready'; statistics: ChatStatistics }
  | { status: 'error'; message: string };

function formatStartedAt(value: string): string {
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function ChatStatisticsScreen({ assistantCreatedAt, conversationId, onBack }: {
  assistantCreatedAt: string; conversationId: string; onBack(): void;
}) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const [state, setState] = useState<StatisticsState>({ status: 'loading' });
  const [showDetails, setShowDetails] = useState(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const requestRevision = ++revision.current;
    try {
      const statistics = await getChatStatistics(conversationId, assistantCreatedAt);
      if (requestRevision === revision.current) setState({ status: 'ready', statistics });
    } catch (error) {
      if (requestRevision === revision.current) setState({ status: 'error', message: error instanceof Error ? error.message : '读取聊天统计失败' });
    }
  }, [assistantCreatedAt, conversationId]);
  useFocusEffect(useCallback(() => {
    void load();
    const unsubscribe = setChatEventBus({ emit: (event, payload) => {
      if (payload.sessionId === conversationId && (event === 'messagesUpdated' || event === 'messagesPatched' || event === 'messagesReloadRequested')) void load();
    } });
    // 失焦／退出后撤销旧查询的展示资格，后发查询也不能被旧快照覆盖。
    return () => { revision.current++; unsubscribe(); };
  }, [conversationId, load]));

  const statistics = state.status === 'ready' ? state.statistics : null;
  const formatNumber = (value: number) => value.toLocaleString('zh-CN');
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
    <NavigationHeader title="相遇痕迹" onGoBack={onBack} />
    <ScrollView contentContainerStyle={styles.content}>
    {state.status === 'loading' && <ActivityIndicator color={theme.colors.brand.primary} accessibilityLabel="正在读取聊天统计" />}
    {state.status === 'error' && <>
      <Text style={styles.error}>{state.message}</Text>
      <Pressable accessibilityRole="button" onPress={() => { setState({ status: 'loading' }); void load(); }}>
        <Text style={styles.retry}>重新读取</Text>
      </Pressable>
    </>}
    {statistics && <>
      <View>
        <Text style={styles.encounter}>在 RavenCat 里相遇已经 {getEncounterDays(statistics.encounterStartedAt, Date.now())} 天</Text>
        <Text style={styles.detail}>起始时间：{formatStartedAt(statistics.encounterStartedAt)}</Text>
      </View>
      <View style={styles.metrics}>
        <View style={[styles.metric, styles.halfMetric]}>
          <Text style={styles.label}>总消息数</Text>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{formatNumber(statistics.userMessageCount + statistics.assistantMessageCount)}</Text>
          <Text style={styles.detail}>你 {formatNumber(statistics.userMessageCount)} · AI {formatNumber(statistics.assistantMessageCount)}</Text>
        </View>
        <View style={[styles.metric, styles.halfMetric]}>
          <Text style={styles.label}>总字数</Text>
          <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{formatNumber(statistics.userCharacterCount + statistics.assistantCharacterCount)}</Text>
          <Text style={styles.detail}>你 {formatNumber(statistics.userCharacterCount)} · AI {formatNumber(statistics.assistantCharacterCount)}</Text>
        </View>
      </View>
      <View style={styles.metric}>
        <Text style={styles.label}>已记录 Token 用量</Text>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>{formatNumber(statistics.totalTokens)}</Text>
        <Text style={styles.detail}>已记录输入 {formatNumber(statistics.promptTokens)} · 输出 {formatNumber(statistics.completionTokens)}</Text>
        {statistics.totalTokens !== statistics.promptTokens + statistics.completionTokens && <Text style={styles.detail}>部分用量没有完整的输入／输出分项，分项之和与合计不一致。</Text>}
      </View>
      <Text style={styles.detail}>未保存的 Token 用量不估算，合计可能低于实际消耗。{statistics.assistantRepliesWithoutUsage > 0 ? `有 ${formatNumber(statistics.assistantRepliesWithoutUsage)} 次 AI 回复没有用量记录。` : ''}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: showDetails }} onPress={() => setShowDetails((value) => !value)}>
        <Text style={styles.retry}>{showDetails ? '收起统计口径' : '查看统计口径'}</Text>
      </Pressable>
      {showDetails && <>
        <Text style={styles.detail}>统计仍保存的单聊原文，不统计摘要、思考过程、工具状态和通话正文。AI 分段及同一次 Agent 完整回复合计一条，你的消息逐条计数。字数按正文字符计，包含标点和空白；语音计转写正文，图片和表情不折算字数。清除历史仅隐藏的原文仍参与，已删除的原文不参与。</Text>
        <Text style={styles.detail}>Token 累计聊天调用已保存的实际用量，包含 Agent 工具循环；不会另加摘要生成用量。输入用量是模型处理的完整上下文，可能包含历史消息和摘要。相遇天数按已度过的完整 24 小时计算。</Text>
      </>}
    </>}
    </ScrollView>
  </SafeAreaView>;
}
