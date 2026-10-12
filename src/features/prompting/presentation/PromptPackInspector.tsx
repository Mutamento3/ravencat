/** 安全预览最终 Prompt Pack，并在用户明确授权时读取真实运行上下文。 */

import { Toggle, showAppDialog } from '@shared/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedSurface, useThemedStyles } from '@shared/theme';
import type { PromptPack, PromptPackMessageContent, PromptScenarioId } from '@shared/prompt';
import {
  getPromptManagementSnapshot, type PromptManagementSnapshot,
} from '../application/GetPromptManagementSnapshot';
import {
  previewResolvedPromptPack, type PromptPackPreviewResult,
} from '../application/PreviewResolvedPromptPack';
import { SCENARIO_LABELS, SLOT_LABELS } from './promptCenterLabels';
import { createPromptPackInspectorStyles } from './promptPackInspectorStyles';

const BINDING_SOURCE_LABELS: Record<PromptPackPreviewResult['bindingSource'], string> = {
  group: '群聊绑定', assistant: 'AI 绑定', global: '全局绑定', system_default: '系统默认',
};

export default function PromptPackInspector() {
  const styles = useThemedStyles(createPromptPackInspectorStyles);
  const [snapshot, setSnapshot] = useState<PromptManagementSnapshot | null>(null);
  const [scenarioId, setScenarioId] = useState<PromptScenarioId>('chat.private_reply');
  const [assistantId, setAssistantId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState<string | null>(null);
  const [exampleInput, setExampleInput] = useState('你好，今天过得怎么样？');
  const [useRealContext, setUseRealContext] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromptPackPreviewResult | null>(null);

  const load = useCallback(async () => {
    try { setSnapshot(await getPromptManagementSnapshot()); }
    catch (error) { showAppDialog({ title: '读取失败', message: getErrorMessage(error), tone: 'error' }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const preview = async () => {
    setLoading(true);
    try {
      setResult(await previewResolvedPromptPack({
        scenarioId, assistantId, groupId, exampleInput, useRealContext,
      }));
    } catch (error) {
      showAppDialog({ title: '预览失败', message: getErrorMessage(error), tone: 'error' });
    } finally { setLoading(false); }
  };

  if (!snapshot) return <Text style={styles.empty}>正在读取预览配置…</Text>;
  return (
    <View style={styles.content}>
      <View style={styles.section}>
        <Text style={styles.title}>即时 Prompt Pack 检查器</Text>
        <Text style={styles.description}>默认只使用安全摘要。预览结果仅保存在当前页面状态，不写入数据库。</Text>
        <Text style={styles.label}>模型任务</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.row}>{snapshot.systemPresets.map((preset) => <Chip key={preset.scenarioId} label={SCENARIO_LABELS[preset.scenarioId]} selected={scenarioId === preset.scenarioId} onPress={() => { setScenarioId(preset.scenarioId); setResult(null); }} styles={styles} />)}</View></ScrollView>
        <Text style={styles.label}>AI 绑定目标</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.row}><Chip label="不指定" selected={!assistantId} onPress={() => setAssistantId(null)} styles={styles} />{snapshot.assistants.map((target) => <Chip key={target.id} label={target.name} selected={assistantId === target.id} onPress={() => setAssistantId(target.id)} styles={styles} />)}</View></ScrollView>
        <Text style={styles.label}>群聊绑定目标</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}><View style={styles.row}><Chip label="不指定" selected={!groupId} onPress={() => setGroupId(null)} styles={styles} />{snapshot.groups.map((target) => <Chip key={target.id} label={target.name} selected={groupId === target.id} onPress={() => setGroupId(target.id)} styles={styles} />)}</View></ScrollView>
        <Text style={styles.label}>示例输入</Text>
        <TextInput value={exampleInput} onChangeText={setExampleInput} multiline style={styles.input} placeholder="输入一条仅用于预览的消息" />
        <View style={styles.toggleRow}><View style={styles.toggleCopy}><Text style={styles.toggleTitle}>读取真实上下文</Text><Text style={styles.toggleText}>开启后，本次会即时读取允许的近期聊天、协议等上下文；正文仍不会持久化。</Text></View><Toggle accessibilityLabel="读取真实上下文" value={useRealContext} onValueChange={confirmRealContext} /></View>
        <TouchableOpacity disabled={loading} style={[styles.previewButton, loading && styles.previewButtonDisabled]} onPress={() => void preview()}><Text style={styles.previewButtonText}>{loading ? '正在编译…' : '生成即时预览'}</Text></TouchableOpacity>
      </View>
      {result ? <PreviewResult result={result} styles={styles} /> : null}
    </View>
  );

  function confirmRealContext(next: boolean) {
    if (!next) { setUseRealContext(false); return; }
    showAppDialog({ title: '读取真实上下文', message: '仅本次预览读取允许的近期数据，预览正文不会保存。是否开启？', buttons: [
      { text: '取消', style: 'cancel' },
      { text: '开启', onPress: () => setUseRealContext(true) },
    ] });
  }
}

function PreviewResult({ result, styles }: { result: PromptPackPreviewResult; styles: ReturnType<typeof createPromptPackInspectorStyles> }) {
  const { pack } = result;
  return <>
    <View style={styles.section}><ThemedSurface variant="card" style={styles.card}><Text style={styles.privacy}>{result.privacyNotice}</Text><Text style={styles.meta}>预设：{result.preset.name}</Text><Text style={styles.meta}>解析来源：{BINDING_SOURCE_LABELS[result.bindingSource]}</Text><View style={styles.metricRow}><Metric value={pack.blocks.length} label="编译块" styles={styles} /><Metric value={pack.estimatedTokenCount} label="估算 Token" styles={styles} /><Metric value={pack.modelMessages.length} label="模型消息" styles={styles} /></View>{pack.truncationLog?.map((entry, index) => <Text key={`${index}:${entry}`} style={styles.meta}>截断：{entry}</Text>)}</ThemedSurface></View>
    <View style={styles.section}><Text style={styles.title}>最终块顺序</Text>{pack.blocks.map((block) => <View key={block.instanceId || `${block.key}:${block.definitionId}`} style={styles.block}><Text style={styles.blockTitle}>{block.title}</Text><Text style={styles.blockMeta}>{block.definitionId || block.key} · {block.slot ? SLOT_LABELS[block.slot] : '未分槽'} · {block.status}</Text><Text style={styles.blockBody}>{block.content || '[空内容]'}</Text></View>)}</View>
    <PromptText title="最终 systemPrompt" text={pack.systemPrompt} styles={styles} />
    <PromptText title="最终模型消息" text={formatModelMessages(pack)} styles={styles} />
  </>;
}

function PromptText({ title, text, styles }: { title: string; text: string; styles: ReturnType<typeof createPromptPackInspectorStyles> }) { return <View style={styles.section}><Text style={styles.title}>{title}</Text><View style={styles.codeBox}><Text selectable style={styles.code}>{text || '[空]'}</Text></View></View>; }
function Metric({ value, label, styles }: { value: number; label: string; styles: ReturnType<typeof createPromptPackInspectorStyles> }) { return <View style={styles.metric}><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function Chip({ label, selected, onPress, styles }: { label: string; selected: boolean; onPress: () => void; styles: ReturnType<typeof createPromptPackInspectorStyles> }) { return <TouchableOpacity style={[styles.chip, selected && styles.chipSelected]} onPress={onPress}><Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text></TouchableOpacity>; }
function formatMessageContent(content: PromptPackMessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => part.type === 'text' ? part.text : '[图片输入]')
    .join('\n');
}
function formatModelMessages(pack: PromptPack) { return pack.modelMessages.map((message, index) => `${index + 1}. ${message.role.toUpperCase()}\n${formatMessageContent(message.content)}`).join('\n\n'); }
function getErrorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
