/** 设置按会话保存，输入草稿与持久事实分离；无效阈值不阻止独立开关保存。 */
import React, { forwardRef, useImperativeHandle, useMemo } from 'react';
import { Text, View } from 'react-native';
import { AppTextInput, Toggle, showAppDialog } from '@shared/ui';
import { AutoSaveErrors } from '@shared/ui/AutoSaveErrors';
import { useAutoSaveDraft } from '@shared/ui/useAutoSaveDraft';
import { ThemedSurface, useTheme, useThemedStyles } from '@shared/theme';
import type { ChatSummarySettings, ChatSummarySettingsPatch } from '../domain/ChatSummaryRepository';
import { createChatSummaryStyles } from './chatSummaryStyles';

export interface ChatSummarySettingsEditor { flush(): Promise<boolean> }
export default forwardRef<ChatSummarySettingsEditor, {
  settings: ChatSummarySettings; pendingTokens: number; busy: boolean; group?: boolean;
  onSave(patch: ChatSummarySettingsPatch): Promise<void>;
}>(function ChatSummarySettingsPanel({ settings, pendingTokens, busy, onSave, group = false }, ref) {
  const theme = useTheme();
  const styles = useThemedStyles(createChatSummaryStyles);
  const initial = useMemo(() => ({ threshold: String(settings.secondaryTokenThreshold), timeout: String(settings.requestTimeoutSeconds),
    maxTokens: settings.maxOutputTokens === null ? '' : String(settings.maxOutputTokens), trigger: String(settings.groupTriggerCount) }),
  [settings.secondaryTokenThreshold, settings.requestTimeoutSeconds, settings.maxOutputTokens, settings.groupTriggerCount]);
  const thresholdEditor = useAutoSaveDraft<typeof initial, ChatSummarySettingsPatch>({
    initial,
    parse(draft, changed) {
      const patch: ChatSummarySettingsPatch = {}, errors: Partial<Record<keyof typeof initial, string>> = {};
      const accepted: (keyof typeof initial)[] = [];
      for (const field of changed) {
        const text = draft[field], value = Number(text);
        if (field === 'maxTokens' && text === '') { patch.maxOutputTokens = null; accepted.push(field); continue; }
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value <= 0 || (field === 'timeout' && value > 3600)) {
          errors[field] = field === 'threshold' ? '请填写正整数 token 阈值' : field === 'trigger' ? '请填写正整数群触发条数' : field === 'timeout' ? '请填写 1～3600 秒最长等待时间' : '请填写正整数输出 token，或留空跟随总结模型';
          continue;
        }
        if (field === 'threshold') patch.secondaryTokenThreshold = value;
        else if (field === 'timeout') patch.requestTimeoutSeconds = value;
        else if (field === 'trigger') patch.groupTriggerCount = value;
        else patch.maxOutputTokens = value;
        accepted.push(field);
      }
      return { patch, accepted, errors };
    },
    save: onSave,
  });
  useImperativeHandle(ref, () => ({ flush: thresholdEditor.flush }), [thresholdEditor.flush]);
  const error = thresholdEditor.errors.threshold;
  const saveSwitch = async (patch: ChatSummarySettingsPatch) => {
    try { await onSave(patch); }
    catch (failure) { showAppDialog({ title: '操作失败', message: failure instanceof Error ? failure.message : '请稍后再试', tone: 'error' }); }
  };
  return <ThemedSurface variant="card" style={styles.card}>
    <View style={styles.row}><Text style={styles.body}>注入已有摘要</Text><Toggle accessibilityLabel="注入已有摘要"
      value={settings.injectEnabled} disabled={busy} onValueChange={(injectEnabled) => { void saveSwitch({ injectEnabled }); }} /></View>
    <Text style={styles.subtitle}>控制来源会话的摘要是否进入主客上下文，不删除记录，也不影响自动生成。关闭后仍可查看和主动查询。</Text>
    {group && <><View style={styles.row}><Text style={styles.body}>群摘要触发条数</Text><AppTextInput accessibilityLabel="群摘要触发条数"
      style={styles.thresholdInput} value={thresholdEditor.draft.trigger} keyboardType="number-pad" editable={!busy}
      onChangeText={(trigger) => thresholdEditor.change({ trigger })} onBlur={() => { void thresholdEditor.flush(); }} /></View>
      {thresholdEditor.errors.trigger && <Text style={styles.danger}>{thresholdEditor.errors.trigger}</Text>}
      <Text style={styles.subtitle}>全群共用，独立于各成员的主客条数和管理员调度窗口。达到门槛后按群处理进度生成。</Text></>}
    <View style={styles.row}><Text style={styles.body}>自动生成摘要</Text><Toggle accessibilityLabel="自动生成摘要"
      value={settings.generationEnabled} disabled={busy || settings.fixedMessageId !== null}
      onValueChange={(generationEnabled) => { void saveSwitch({ generationEnabled }); }} /></View>
    <Text style={styles.subtitle}>{settings.fixedMessageId !== null
      ? '已固定消息起点，自动生成暂停。取消固定后仍保持关闭，需手动开启，从原来的总结进度继续。'
      : group ? '开启后按群触发条数与处理进度分批总结，一级达到 token 阈值后生成二级。关闭时使用各成员的主·群聊窗口，已有摘要按上方开关注入。'
        : '开启后按原进度分批总结聊天与通话，一级达到 token 阈值后生成二级。关闭时仅保留近期消息窗口，已有摘要按上方开关注入。'}</Text>
    <View style={styles.row}><Text style={styles.body}>开启二级摘要</Text><Toggle accessibilityLabel="开启二级摘要"
      value={settings.secondaryEnabled} disabled={busy} onValueChange={(secondaryEnabled) => { void saveSwitch({ secondaryEnabled }); }} /></View>
    <Text style={styles.subtitle}>只归纳已形成的一级摘要，保留重要事件与实体。关闭二级摘要时恢复注入现存一级摘要，暂停新的归纳。</Text>
    <View style={styles.row}><Text style={styles.body}>一级摘要最大 token</Text><AppTextInput accessibilityLabel="一级摘要最大 token"
      style={[styles.thresholdInput, error && { borderColor: theme.colors.feedback.error }]} value={thresholdEditor.draft.threshold}
      onChangeText={(threshold) => thresholdEditor.change({ threshold })} onBlur={() => { void thresholdEditor.flush(); }}
      editable={!busy && settings.secondaryEnabled} keyboardType="number-pad" returnKeyType="done" submitBehavior="blurAndSubmit" /></View>
    {error && <Text accessibilityRole="alert" style={styles.danger}>{error}</Text>}
    <View style={styles.row}><Text style={styles.body}>摘要最长等待（秒）</Text><AppTextInput accessibilityLabel="摘要最长等待秒数"
      style={styles.thresholdInput} keyboardType="number-pad" value={thresholdEditor.draft.timeout} editable={!busy}
      onChangeText={(timeout) => thresholdEditor.change({ timeout })} onBlur={() => { void thresholdEditor.flush(); }} /></View>
    {thresholdEditor.errors.timeout && <Text accessibilityRole="alert" style={styles.danger}>{thresholdEditor.errors.timeout}</Text>}
    <View style={styles.row}><Text style={styles.body}>摘要输出 token 上限</Text><AppTextInput accessibilityLabel="摘要输出 token 上限"
      style={styles.thresholdInput} keyboardType="number-pad" value={thresholdEditor.draft.maxTokens} placeholder="跟随总结模型" editable={!busy}
      onChangeText={(maxTokens) => thresholdEditor.change({ maxTokens })} onBlur={() => { void thresholdEditor.flush(); }} /></View>
    {thresholdEditor.errors.maxTokens && <Text accessibilityRole="alert" style={styles.danger}>{thresholdEditor.errors.maxTokens}</Text>}
    <Text style={styles.meta}>请求参数仅影响本会话摘要，不改变普通聊天。输出额度留空跟随实际总结模型，与归纳阈值独立。输入停顿 1 秒自动保存，失焦立即保存。</Text>
    <AutoSaveErrors error={thresholdEditor.saveError} blocked={false}
      retry={() => { void thresholdEditor.flush(); }} restore={() => { void thresholdEditor.restore(); }} />
    <Text style={styles.meta}>待归纳一级摘要：约 {pendingTokens} token。按正文估算；新增后达到阈值，领取当时全部待归纳摘要，包含刚新增的一批。成功后才替换上下文。</Text>
    <Text style={styles.meta}>一级与二级摘要独立维护，编辑或删除不会自动同步另一层，需要同步时请分别修改。</Text>
  </ThemedSurface>;
});
