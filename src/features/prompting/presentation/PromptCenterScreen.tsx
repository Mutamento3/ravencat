/** 默认页只表达注入顺序；正文、权限和列表留在各自详情页。 */
import { getAssistantDisplayName } from '@features/assistants';
import { Toggle, showAppDialog } from '@shared/ui';
import { CHAT_PROMPT_READING_FLOW, type ChatPromptReadingStep } from '@shared/prompt';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ChevronDown, ChevronRight, Star } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import NavigationHeader from '@shared/ui/NavigationHeader';
import ModalSheet from '@shared/ui/ModalSheet';
import { getPromptCenterSnapshot } from '../application/GetPromptCenterSnapshot';
import { deleteDefaultUserPrompt, getDefaultPromptEditor, getPromptAssistant, moveDefaultUserPrompt, resetDefaultDefinition, saveDefaultDefinition, saveDefaultUserPrompt, setDefaultPromptSwitch } from '../application/ManagePromptDefaults';
import { applyAssistantDirectToolsGlobally, createAssistantUserPrompt, deleteAssistantUserPrompt, getAssistantPromptEditorDetails, reorderAssistantUserPrompts, resetAssistantDefinitionOverride, saveAssistantDefinitionOverride, saveAssistantDefinitionState, setAssistantToolPermission, setAssistantDirectToolExposure, updateAssistantUserPrompt } from '../application/ManageAssistantPrompts';
import type { AssistantPromptEditorDetails } from '../application/ManageAssistantPrompts';
import type { PromptAssistantOption, PromptAssistantSummary } from '../application/PromptingRuntimeDependencies';
import type { DefaultUserPrompt } from '../domain/PromptDefaults';
import type { AssistantUserPrompt } from '../domain/Prompting';
import { CustomPromptRow } from './CustomPromptRow';
import { createPromptCenterStyles } from './promptCenterStyles';

export type PromptCenterPage = { kind: 'overview' } | { kind: 'custom' } | { kind: 'tools' } | { kind: 'package'; id: string } | { kind: 'editor'; definitionId: 'foundation.default_core' | 'foundation.visual_grounding' } | { kind: 'userEditor'; promptId?: string } | { kind: 'persona' };
type Snapshot = Awaited<ReturnType<typeof getDefaultPromptEditor>>;
const PACKAGE_NAMES: Record<string, string> = { webTools: '联网工具包', media: '图片', applicationSettings: '应用设置工具', protocol: '协议空间', moments: '时刻', wallet: '羽库记账', calls: '通话', memory: '记忆', chat: '语音', stickers: '表情包', togetherListening: '一起听', host: '主理 AI 专属' };

/** 展示按产品用途分包；摘要查询仍由 Chat 拥有，主理工具统一在专属包管理。 */
function getToolPackageId(tool: Snapshot['tools'][number]): string {
  if (tool.packageId) return tool.packageId;
  if (tool.hostOnly) return 'host';
  if (tool.name === 'search_chat_summaries') return 'memory';
  return tool.owner;
}

interface Props {
  assistants: PromptAssistantOption[];
  assistantListError: boolean;
  onSelectAssistant: (assistantId: string) => void;
  onOpenGlobalPrompts: () => void;
  page: PromptCenterPage;
  refreshRevision: number;
  onOpenPage: (page: PromptCenterPage) => void;
  assistantId?: string;
  onBack: () => void;
  onOpenMcp: () => void;
  onOpenWebSearch: () => void;
  onOpenUserProfile: () => void;
  onOpenProtocols: (assistantId: string) => void;
}

export default function PromptCenterScreen({ assistants, assistantListError, onSelectAssistant, onOpenGlobalPrompts, page, refreshRevision, onOpenPage, assistantId, onBack, onOpenMcp, onOpenWebSearch, onOpenUserProfile, onOpenProtocols }: Props) {
  const theme = useTheme();
  const styles = useThemedStyles(createPromptCenterStyles);
  const catalog = useMemo(() => getPromptCenterSnapshot(), []);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [assistant, setAssistant] = useState<PromptAssistantSummary | null>(null);
  const [details, setDetails] = useState<AssistantPromptEditorDetails | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [directToolsExpanded, setDirectToolsExpanded] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const refresh = useCallback(async () => {
    const next = await getDefaultPromptEditor();
    if (assistantId) {
      const [selected, editorDetails] = await Promise.all([getPromptAssistant(assistantId), getAssistantPromptEditorDetails(assistantId)]);
      setAssistant(selected); setDetails(editorDetails);
    }
    setSnapshot(next);
  }, [assistantId]);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const next = await getDefaultPromptEditor();
        const selected = assistantId ? await getPromptAssistant(assistantId) : null;
        const editorDetails = assistantId ? await getAssistantPromptEditorDetails(assistantId) : null;
        if (active) {
          if (!initialized.current) {
            if (page.kind === 'editor') {
              const override = editorDetails?.overrides.find((item) => item.definitionId === page.definitionId && item.locale === 'zh-CN');
              setContent(override?.content ?? next.overrides[page.definitionId] ?? catalog.definitions.find((item) => item.id === page.definitionId)!.defaultContent!);
            }
            else if (page.kind === 'userEditor' && page.promptId) {
              const prompt = (assistantId ? editorDetails!.userPrompts : next.userPrompts).find((item) => item.id === page.promptId);
              if (!prompt) throw new Error('该提示词不存在');
              setName(prompt.name); setContent(prompt.content);
            }
            initialized.current = true;
          }
          setSnapshot(next); setAssistant(selected); setDetails(editorDetails); setLoadError(false);
        }
      } catch (error) { if (active) { setLoadError(true); showAppDialog({ title: '读取失败', message: errorMessage(error), tone: 'error' }); } }
    })();
    return () => { active = false; };
  }, [assistantId, catalog, page, refreshRevision]);
  async function mutate(action: () => Promise<unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      // 保存期间可能已被系统返回弹出，完成后不能再次退出父页。
      if (!mounted.current) return;
      await refresh();
      if (mounted.current) after?.();
    } catch (error) {
      if (mounted.current) showAppDialog({ title: '保存失败', message: errorMessage(error), tone: 'error' });
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function openDefinition(definitionId: 'foundation.default_core' | 'foundation.visual_grounding') { onOpenPage({ kind: 'editor', definitionId }); }
  function openUser(prompt: DefaultUserPrompt | AssistantUserPrompt | null) { onOpenPage({ kind: 'userEditor', promptId: prompt?.id }); }
  function saveEditor() {
    void mutate(async () => {
      if (page.kind === 'editor') {
        if (assistantId) await saveAssistantDefinitionOverride({ assistantId, definitionId: page.definitionId, locale: 'zh-CN', content });
        else await saveDefaultDefinition(page.definitionId, content);
      } else if (page.kind === 'userEditor') {
        const sortOrder = Math.max(0, ...prompts.map((item) => item.sortOrder)) + 10;
        if (assistantId) {
          if (editingPrompt) await updateAssistantUserPrompt({ ...(editingPrompt as AssistantUserPrompt), name, content });
          else await createAssistantUserPrompt({ assistantId, name, content, condition: 'always', enabled: true, sortOrder });
        } else {
          await saveDefaultUserPrompt({
            id: editingPrompt?.id ?? `default_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name, content, enabled: editingPrompt?.enabled ?? true,
            sortOrder: editingPrompt?.sortOrder ?? sortOrder,
          });
        }
      }
    }, onBack);
  }
  function resetDefinition(definitionId: string) {
    showAppDialog({ title: '恢复默认', message: '恢复这一项的默认正文？', buttons: [
      { text: '取消', style: 'cancel' },
      { text: '恢复', onPress: () => {
        void mutate(async () => {
          if (assistantId) await resetAssistantDefinitionOverride({ assistantId, definitionId, locale: 'zh-CN' });
          else await resetDefaultDefinition(definitionId);
        }, () => {
          const codeDefault = catalog.definitions.find((item) => item.id === definitionId)!.defaultContent!;
          setContent(assistantId ? snapshot!.overrides[definitionId] ?? codeDefault : codeDefault);
        });
      } },
    ] });
  }
  function togglePrompt(prompt: DefaultUserPrompt | AssistantUserPrompt, enabled: boolean) {
    void mutate(() => assistantId
      ? updateAssistantUserPrompt({ ...(prompt as AssistantUserPrompt), enabled })
      : saveDefaultUserPrompt({ ...prompt, enabled }));
  }
  function movePrompt(prompt: DefaultUserPrompt | AssistantUserPrompt, index: number, offset: number) {
    const target = prompts[index + offset];
    if (target) void mutate(() => assistantId
      ? reorderAssistantUserPrompts(prompt as AssistantUserPrompt, target as AssistantUserPrompt)
      : moveDefaultUserPrompt(prompt, target));
  }
  function deletePrompt(prompt: DefaultUserPrompt) {
    showAppDialog({ title: assistantId ? '删除提示词' : '删除全局提示词', message: assistantId ? `删除“${prompt.name}”？` : `删除“${prompt.name}”后，所有 AI 将不再注入这条常驻提示词。`, buttons: [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: () => {
        void mutate(() => assistantId ? deleteAssistantUserPrompt(prompt.id, assistantId) : deleteDefaultUserPrompt(prompt.id));
      } },
    ] });
  }
  function toggleTool(toolName: string, enabled: boolean) {
    void mutate(() => assistantId ? setAssistantToolPermission(assistantId, toolName, enabled)
      : setDefaultPromptSwitch(`tool:${toolName}`, enabled));
  }
  const tools = snapshot?.tools.filter((tool) => !tool.cooldownOnly || assistant?.isInHostCooldown).map((tool) => ({ ...tool, enabled: details?.tools.find((item) => item.name === tool.name)?.enabled ?? tool.enabled })) ?? [];
  const directToolNames = new Set(details?.directToolNames);
  const directTools = tools.filter((tool) => directToolNames.has(tool.name));
  const packages = [...new Set(tools.map(getToolPackageId))]
    .sort((a, b) => a === 'host' ? -1 : b === 'host' ? 1 : 0);
  const prompts = assistantId ? details?.userPrompts ?? [] : snapshot?.userPrompts ?? [];
  const editingPrompt = page.kind === 'userEditor' ? prompts.find((item) => item.id === page.promptId) : undefined;
  const title = page.kind === 'overview' ? '提示词中心' : page.kind === 'custom' ? (assistantId ? '自定义提示词' : '全局常驻提示词') : page.kind === 'tools' ? '工具调用' : page.kind === 'package' ? PACKAGE_NAMES[page.id] ?? page.id : page.kind === 'editor' ? (page.definitionId === 'foundation.default_core' ? '系统基础规则' : '视觉真实性规则') : page.kind === 'persona' ? 'AI 人设' : page.promptId ? '编辑提示词' : '添加提示词';
  function row(label: string, description: string, action?: () => void, number?: number, disabled = false, right?: React.ReactNode) {
    const body = <>
      {number !== undefined && <Text style={styles.number}>{String(number).padStart(2, '0')}</Text>}
      <View style={styles.copy}><Text style={styles.title}>{label}</Text><Text style={styles.subtitle}>{description}</Text></View>
      {right ?? (action && !disabled ? <ChevronRight size={18} color={theme.colors.text.tertiary} /> : null)}
    </>;
    return action ? <TouchableOpacity key={label} accessibilityRole="button" disabled={disabled || busy} onPress={action} activeOpacity={0.7} style={[styles.row, disabled && styles.muted]}>{body}</TouchableOpacity>
      : <View key={label} style={[styles.row, disabled && styles.muted]}>{body}</View>;
  }
  function readingStep(step: ChatPromptReadingStep, position: number) {
    switch (step) {
      case 'foundation': return row('系统基础规则', '运行环境、行为边界与视觉真实性', () => openDefinition('foundation.default_core'), position);
      case 'persona': return <ThemedSurface variant="card" style={styles.card}>
        <View style={styles.cardHeader}><Text style={styles.number}>{String(position).padStart(2, '0')}</Text><Text style={styles.title}>人设</Text></View>
        {row('AI 人设', assistant ? '查看当前人设 · 在对话设置中修改' : '当前未绑定 AI，无法查看', assistant ? () => onOpenPage({ kind: 'persona' }) : undefined, undefined, !assistant)}
        {row('用户人设', '在个人资料中修改 · 自动保存 · 所有 AI 共用', onOpenUserProfile)}
      </ThemedSurface>;
      case 'group_identity': return row('群聊身份背景', '群聊时提供群名称、成员及当前 AI 的群内身份', undefined, position);
      case 'protocol': return row('协议空间常驻提示词', assistant ? '你与 AI 均可修改的固定注入信息，全部持续生效' : '当前未绑定 AI，无法查看', assistant ? () => onOpenProtocols(assistant.id) : undefined, position, !assistant);
      case 'agent_registry': return row('AI 身份池', '共同的身份背景，供所有聊天 AI 了解彼此', undefined, position);
      case 'custom': return row('自定义提示词', `${prompts.length} 条${assistant ? '专属' : '全局'}提示词 · 按列表顺序拼接`, () => onOpenPage({ kind: 'custom' }), position);
      case 'tools': return row('工具调用', '按用途管理工具包与调用权限', () => onOpenPage({ kind: 'tools' }), position);
      case 'mcp': return row('MCP', '外部服务由 MCP 模块按需注入', onOpenMcp, position);
      case 'history': return row('历史聊天', '聊天、用户操作与应用事件按发生顺序进入历史和摘要', undefined, position);
      case 'tool_runtime': return row('工具运行上下文', '有可用工具时提供本轮调用的运行上下文', undefined, position);
      case 'user_state': return row('用户状态与一起听', '本轮的用户状态与共同活动', undefined, position);
      case 'social': return row('时刻社交信息', '单聊与群聊均提供当前 AI 的未读事件；群聊另含近期可见时刻', undefined, position);
      case 'environment': return row('环境信息', '当前单聊、群聊或通话 · 本轮由用户、账本或日程等来源触发', undefined, position);
      case 'assistant_state': return row('AI 当前身份状态', '按需提供原主理 AI 冷静期及剩余时间', undefined, position);
      case 'memory': return row('被动记忆', '按当前输入触发的历史资料', undefined, position);
      case 'battery': return row('手机电量', assistant ? '本轮电量与充电状态 · 关闭后不读取 · 仅对这位 AI 生效' : '选择 AI 后可调整电量注入', undefined, position, false,
        <Toggle accessibilityLabel="注入手机电量" disabled={busy || !assistant} value={details?.batteryEnabled ?? true} onValueChange={(enabled) => { void mutate(() => saveAssistantDefinitionState({ assistantId: assistantId!, definitionId: 'context.device_battery', enabled })); }} />);
      case 'time': return row('当前时间', assistant ? '为本轮校准现在 · 开关仅对这位 AI 生效' : '选择 AI 后可调整时间注入', undefined, position, false,
        <Toggle accessibilityLabel="注入当前时间" disabled={busy || !assistant} value={details?.timeEnabled ?? true} onValueChange={(enabled) => { void mutate(() => saveAssistantDefinitionState({ assistantId: assistantId!, definitionId: 'context.time_awareness', enabled })); }} />);
      case 'output': return row('本轮回应要求', '按场景提供记账回复、日程行动等本轮执行与输出要求', undefined, position);
      case 'input': return row('当前聊天', '真实用户输入位于最后；账本、日程等应用触发时省略', undefined, position);
    }
  }
  const readingSections = { identity: '先认识彼此', capabilities: '可用的能力', context: '从过去，回到现在' };
  const rightButton = page.kind === 'custom' ? <TouchableOpacity disabled={busy} onPress={() => openUser(null)}><Text style={styles.action}>添加</Text></TouchableOpacity> : undefined;
  return <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}><View style={styles.screen}>
    <NavigationHeader title={title} onGoBack={onBack} rightButton={rightButton} />
    {assistantListError ? <Text style={styles.description}>未能读取 AI 列表，请返回后重新打开。</Text> : !snapshot ? loadError ? <Text style={styles.description}>未能读取提示词配置，请返回后重新打开。</Text> : <ActivityIndicator style={styles.loading} /> : <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {page.kind === 'overview' && <>
        <View style={styles.hero}><Text style={styles.eyebrow}>{assistant ? getAssistantDisplayName(assistant) : '全局默认'} · 中文</Text><Text style={styles.heading}>从身份，到此刻</Text><Text style={styles.description}>单聊、群聊、记账回应和日程唤醒共用以下顺序。
有内容且满足场景条件的条目才会带入。</Text></View>
        {row('编辑对象', assistant ? `${getAssistantDisplayName(assistant)}${assistant.isHostAI ? ' · 主理 AI' : ''} · 本页改动只对这位 AI 生效` : '暂无 AI', () => setSelectorOpen(true), undefined, !assistants.length)}
        {CHAT_PROMPT_READING_FLOW.map((step, index) => <React.Fragment key={step.id}>
          {(index === 0 || CHAT_PROMPT_READING_FLOW[index - 1].section !== step.section)
            && <Text style={styles.section}>{readingSections[step.section]}</Text>}
          {readingStep(step.id, index + 1)}
        </React.Fragment>)}
      </>}
      {page.kind === 'persona' && <>
        <Text style={styles.description}>人设在这位 AI 的对话设置中修改，保存后同步显示在这里。</Text>
        <ThemedSurface variant="card" style={styles.card}><Text selectable style={styles.body}>{assistant!.persona || '尚未设置 AI 人设'}</Text></ThemedSurface>
      </>}
      {(page.kind === 'editor' || page.kind === 'userEditor') && <>
        {page.kind === 'userEditor' && !assistantId && <Text style={styles.description}>全局常驻提示词 · 保存后对所有 AI 生效。</Text>}
        {page.kind === 'editor' && <>
          <View style={styles.actions}>
            <TouchableOpacity disabled={busy || page.definitionId === 'foundation.default_core'} onPress={() => openDefinition('foundation.default_core')}><Text style={styles.action}>基础规则</Text></TouchableOpacity>
            <TouchableOpacity disabled={busy || page.definitionId === 'foundation.visual_grounding'} onPress={() => openDefinition('foundation.visual_grounding')}><Text style={styles.action}>视觉规则</Text></TouchableOpacity>
          </View>
          <Text style={styles.description}>两项规则在这里统一管理；视觉规则只在本轮涉及视觉时注入。编辑后保存，再切换条目。</Text>
        </>}
        {page.kind === 'userEditor' && <TextInput accessibilityLabel="提示词名称" placeholder="提示词名称" placeholderTextColor={theme.colors.text.tertiary} value={name} onChangeText={setName} style={styles.input} editable={!busy} />}
        <TextInput accessibilityLabel="提示词正文" placeholder="写下你的提示词…" placeholderTextColor={theme.colors.text.tertiary} multiline value={content} onChangeText={setContent} style={[styles.input, styles.editor]} editable={!busy} />
        {page.kind === 'editor' && <TouchableOpacity disabled={busy} onPress={() => resetDefinition(page.definitionId)}><Text style={styles.action}>恢复默认</Text></TouchableOpacity>}
        <TouchableOpacity disabled={busy} style={styles.button} onPress={saveEditor}><Text style={styles.buttonText}>{busy ? '保存中…' : '保存'}</Text></TouchableOpacity>
      </>}
      {page.kind === 'custom' && <>
        <Text style={styles.description}>长按卡片上下移动，列表顺序就是这些提示词的拼接顺序。{assistant ? `下面的修改只对 ${getAssistantDisplayName(assistant)} 生效。` : '这里是无 AI 时添加的全局常驻提示词，修改、关闭或删除会影响所有 AI。'}</Text>
        {assistant && row('全局常驻提示词', `${snapshot.userPrompts.length} 条 · 单独管理对所有 AI 生效的提示词`, onOpenGlobalPrompts)}
        {!prompts.length && <ThemedSurface variant="card" style={styles.card}><Text style={styles.title}>留一点空间给你的想法</Text><Text style={styles.body}>还没有自定义提示词，点击右上角添加。</Text></ThemedSurface>}
        {prompts.map((prompt, index) => <CustomPromptRow key={prompt.id} prompt={prompt} index={index} disabled={busy} styles={styles}
          onEdit={() => openUser(prompt)} onToggle={(enabled) => togglePrompt(prompt, enabled)}
          onMove={(offset) => movePrompt(prompt, index, offset)} onDelete={() => deletePrompt(prompt)} />)}
      </>}
      {page.kind === 'tools' && <>
        <Text style={styles.description}>{assistant ? '这位 AI 的单项权限；总开关、场景与身份边界仍共同决定本轮可用工具。全局应用会以当前普通工具星标覆盖所有现有 AI，主理专属星标与调用权限保持不变。' : '全局默认权限；AI 的单独设置可以覆盖默认值。主理专属工具仍只授予主理 AI。'}</Text>
        <ThemedSurface variant="card" style={styles.card}>
          <View style={styles.cardHeader}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="特批工具" accessibilityState={{ expanded: directToolsExpanded }}
              activeOpacity={0.7} style={[styles.cardHeader, styles.collapsibleHeader, styles.copy]} onPress={() => setDirectToolsExpanded((expanded) => !expanded)}>
              <Star size={20} color={theme.colors.brand.primary} fill={theme.colors.brand.primary} />
              <Text style={[styles.title, styles.copy]}>特批工具</Text>
              <Text style={styles.subtitle}>{directTools.length} 个</Text>
              {directToolsExpanded ? <ChevronDown size={18} color={theme.colors.text.tertiary} /> : <ChevronRight size={18} color={theme.colors.text.tertiary} />}
            </TouchableOpacity>
            {assistant && <TouchableOpacity accessibilityRole="button" accessibilityLabel="全局应用特批工具" accessibilityState={{ disabled: busy }}
              disabled={busy} style={styles.actionButton} onPress={() => {
                const snapshotNames = [...directToolNames];
                void mutate(() => applyAssistantDirectToolsGlobally(snapshotNames), () => showAppDialog({ title: '已全局应用', message: '普通工具星标已同步到所有现有 AI；主理专属星标与调用权限保持不变。' }));
              }}><Text style={[styles.action, busy && styles.muted]}>全局应用</Text></TouchableOpacity>}
          </View>
          {directToolsExpanded && (directTools.length > 0 ? directTools.map((tool) => {
            const packageId = getToolPackageId(tool);
            return row(tool.name, `${PACKAGE_NAMES[packageId] ?? packageId} · ${tool.enabled ? '允许调用' : '单项权限已关闭'}`,
              () => onOpenPage({ kind: 'package', id: packageId }));
          }) : <Text style={styles.body}>{assistant ? '暂无特批工具，进入下方工具包点亮工具旁的星标即可添加。' : '选择 AI 后可在工具包中配置特批工具。'}</Text>)}
        </ThemedSurface>
        {packages.map((id) => row(PACKAGE_NAMES[id] ?? id, `${tools.filter((tool) => getToolPackageId(tool) === id).length} 个工具`, () => onOpenPage({ kind: 'package', id })))}
      </>}
      {page.kind === 'package' && <>
        {page.id === 'webTools' && row('搜索来源配置', '设置默认来源、Tavily 与 Brave 密钥；也可从「AI 工具 → 联网搜索」进入', onOpenWebSearch)}
        <Text style={styles.description}>{assistant ? `点亮星标，将工具设为 ${getAssistantDisplayName(assistant)} 的用户特批工具，直接注入说明与调用参数，无需拆包。右侧开关仍控制调用权限。` : '选择 AI 后可配置星标特批工具；这里仅管理全局默认调用权限。'}</Text>
        {tools.filter((tool) => getToolPackageId(tool) === page.id).map((tool) => <ThemedSurface variant="card" nativeGlass={false} key={tool.name} style={styles.card}>
          <View style={styles.cardHeader}><Text style={[styles.title, styles.copy]}>{tool.name}</Text>
            {assistantId && <TouchableOpacity accessibilityRole="switch" accessibilityLabel={`直接暴露 ${tool.name}`} accessibilityState={{ checked: directToolNames.has(tool.name), disabled: busy || (tool.hostOnly && !(tool.cooldownOnly ? assistant?.isInHostCooldown : assistant?.isHostAI)) }}
              disabled={busy || (tool.hostOnly && !(tool.cooldownOnly ? assistant?.isInHostCooldown : assistant?.isHostAI))} style={styles.starButton}
              onPress={() => { void mutate(() => setAssistantDirectToolExposure(assistantId, tool.name, !directToolNames.has(tool.name))); }}>
              <Star size={22} color={directToolNames.has(tool.name) ? theme.colors.brand.primary : theme.colors.text.tertiary} fill={directToolNames.has(tool.name) ? theme.colors.brand.primary : 'none'} />
            </TouchableOpacity>}
            <Toggle accessibilityLabel={`启用 ${tool.name}`} disabled={busy || (tool.hostOnly && !(tool.cooldownOnly ? assistant?.isInHostCooldown : assistant?.isHostAI))} value={tool.enabled} onValueChange={(enabled) => toggleTool(tool.name, enabled)} /></View>
          <Text selectable style={styles.body}>{tool.description}</Text>
        </ThemedSurface>)}
      </>}
    </ScrollView>}
    {selectorOpen && <ModalSheet visible onClose={() => setSelectorOpen(false)} title="选择编辑的 AI">
      <ScrollView contentContainerStyle={styles.content}>
        {assistants.map((option) => row(option.name, `${option.isHostAI ? '主理 AI · ' : ''}${option.id === assistantId ? '当前编辑对象' : '仅调整这位 AI 的提示词'}`, () => { setSelectorOpen(false); onSelectAssistant(option.id); }))}
      </ScrollView>
    </ModalSheet>}
  </View></SafeAreaView>;
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '操作失败'; }
