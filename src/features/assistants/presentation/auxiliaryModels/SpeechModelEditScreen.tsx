import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  SPEECH_PROVIDERS,
  getSpeechParameters,
  listSpeechProviderOptions,
  SpeechConfigurationTest,
  type SpeechProviderOptions,
  type SpeechConnectionConfig,
  type SpeechKind,
  type SpeechProviderId,
} from '@features/speech';
import { KeyboardAvoidingContainer, Button, DropdownField, InputField, ToggleField, showAppDialog } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { useTheme } from '@shared/theme';
import { useAutoSaveDraft, useAutoSaveNavigation } from '@shared/ui/useAutoSaveDraft';
import { useAutoSaveFeedback } from '@shared/ui/useAutoSaveFeedback';
import { AutoSaveErrors } from '@shared/ui/AutoSaveErrors';
import {
  buildSpeechDraftConfiguration,
  getSpeechModelDraft,
  parseSpeechModelDraft,
  switchSpeechProvider,
  type SpeechModelDraft,
} from './speechModelDraft';
import type { AuxiliaryModelConfig, UpdateAuxiliaryModelConfigInput } from '../../domain/AuxiliaryModel';
import type { AuxiliaryModelFormData } from './types';

export default function SpeechModelEditScreen({
  kind,
  modelId,
  initialData,
  saving,
  onSave,
  onCreate,
  onDelete,
  onBack,
}: {
  kind: SpeechKind;
  modelId?: string;
  initialData: AuxiliaryModelConfig | null;
  saving: boolean;
  onSave(data: UpdateAuxiliaryModelConfigInput): Promise<void>;
  onCreate(data: AuxiliaryModelFormData): Promise<void>;
  onDelete?: () => Promise<void>;
  onBack(): void;
}) {
  const theme = useTheme();
  const initial = useMemo(() => getSpeechModelDraft(kind, initialData), [kind, initialData]);
  const parse = useCallback(
    (draft: SpeechModelDraft, changed: (keyof SpeechModelDraft)[]) =>
      parseSpeechModelDraft(kind, draft, changed),
    [kind],
  );
  const editor = useAutoSaveDraft({ initial, parse, save: onSave, enabled: !!modelId });
  const { draft, errors, change, commit, flush, restore, validateAll } = editor;
  const feedback = useAutoSaveFeedback(errors);
  const { back } = useAutoSaveNavigation(
    flush,
    onBack,
    () => feedback.revealErrors(editor.getSnapshot().errors),
    !!modelId,
  );
  const [creationError, setCreationError] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [options, setOptions] = useState<SpeechProviderOptions | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const optionsRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    setOptions(null);
    setOptionsError(null);
    setLoadingOptions(false);
    return () => {
      optionsRequest.current?.abort();
      optionsRequest.current = null;
    };
  }, [draft.provider, draft.apiKey, draft.baseUrl]);
  const provider = SPEECH_PROVIDERS.find((entry) => entry.id === draft.provider && entry.kind === kind);
  const fields = provider ? getSpeechParameters(provider.id, draft.model) : [];
  const modelOptions = options?.models ?? provider?.models.map((value) => ({ value, label: value })) ?? [];
  const loadOptions = async () => {
    if (!draft.apiKey.trim()) {
      setOptionsError('请先填写 API Key');
      return;
    }
    optionsRequest.current?.abort();
    const controller = new AbortController();
    optionsRequest.current = controller;
    setLoadingOptions(true);
    setOptionsError(null);
    try {
      const result = await listSpeechProviderOptions(buildSpeechDraftConfiguration(draft), controller.signal);
      if (!controller.signal.aborted) setOptions(result);
    } catch (error) {
      if (!controller.signal.aborted) setOptionsError(error instanceof Error ? error.message : '加载失败');
    } finally {
      if (!controller.signal.aborted) setLoadingOptions(false);
    }
  };
  const blur = () => {
    if (modelId) void commit();
  };
  const set = (key: string, value: string | boolean, immediate = false) => {
    setTestError(null);
    change(
      { [key]: value, ...(key === 'region' || key === 'workspaceId' ? { preserveEndpoint: false } : {}) },
      immediate,
    );
  };
  const getConfiguration = (): SpeechConnectionConfig | null => {
    const values = validateAll();
    if (!values) {
      feedback.revealErrors(editor.getSnapshot().errors);
      setAdvanced(true);
      return null;
    }
    if (!draft.apiKey.trim()) {
      setTestError(`请填写 ${provider!.credentialLabel} 后测试`);
      return null;
    }
    return {
      baseURL: values.baseUrl!,
      apiKey: values.apiKey!,
      model: values.model!,
      metadataJson: values.metadataJson!,
    };
  };
  const create = async () => {
    const values = validateAll();
    if (!values) {
      feedback.revealErrors(editor.getSnapshot().errors);
      setAdvanced(true);
      return;
    }
    setCreationError(null);
    try {
      await onCreate({
        name: values.name!,
        enabled: values.enabled!,
        baseUrl: values.baseUrl!,
        apiKey: values.apiKey ?? '',
        model: values.model!,
        metadataJson: values.metadataJson,
        temperature: null,
        topP: null,
        maxTokens: null,
      });
    } catch (error) {
      setCreationError(error instanceof Error ? error.message : '创建失败，你的输入已保留');
    }
  };
  const remove = () =>
    showAppDialog({ title: '删除配置', message: `确定删除「${draft.name}」？`, buttons: [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void restore().then(onDelete);
        },
      },
    ] });
  const reset = () => {
    void restore().then(() => feedback.setBlocked(false));
  };
  const setModel = (model: string, immediate = false) => {
    const next: Partial<SpeechModelDraft> = { model };
    const allowed = getSpeechParameters(provider!.id, model);
    // 新模型不再支持的枚举值由选择动作清空，不能随着隐藏表单进入请求。
    for (const field of allowed)
      if (field.type === 'select' && draft[field.key] && !field.options!.includes(String(draft[field.key])))
        next[field.key] = field.defaultValue == null ? '' : String(field.defaultValue);
      else if (field.type === 'boolean' && typeof draft[field.key] !== 'boolean')
        next[field.key] = field.defaultValue === true;
    change(next, immediate);
  };
  const rightButton = modelId ? (
    feedback.blocked ? (
      <Button title="恢复" variant="text" onPress={reset} />
    ) : undefined
  ) : (
    <Button
      title={saving ? '创建中…' : '创建'}
      variant="text"
      disabled={saving}
      onPress={() => {
        void create();
      }}
    />
  );
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: theme.colors.background.app }}
      edges={['top', 'left', 'right']}
    >
      <KeyboardAvoidingContainer style={{ flex: 1 }}>
        <NavigationHeader
          title={`${modelId ? '编辑' : '新建'}${kind === 'tts' ? '语音合成' : '实时语音识别'}`}
          onGoBack={back}
          rightButton={rightButton}
        />
        <AutoSaveErrors
          error={editor.saveError || creationError}
          blocked={!!modelId && feedback.blocked}
          retry={blur}
          restore={modelId ? reset : undefined}
        />
        <ScrollView
          ref={feedback.scrollRef}
          contentContainerStyle={{ padding: theme.spacing.lg, paddingBottom: theme.spacing.xl }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View onLayout={feedback.fieldLayout(['provider'])}>
            <DropdownField
              label="提供方"
              value={draft.provider}
              options={SPEECH_PROVIDERS.filter((entry) => entry.kind === kind).map((entry) => ({
                value: entry.id,
                label: entry.label,
              }))}
              error={errors.provider}
              onChange={(value) => {
                if (value === draft.provider) return;
                change(switchSpeechProvider(value as SpeechProviderId), true);
              }}
            />
          </View>
          {!provider ? (
            <Text style={{ color: theme.colors.feedback.error }}>原配置的提供方无效，请重新选择。</Text>
          ) : null}
          <InputField
            label="配置名称"
            value={draft.name}
            onChangeText={(value) => set('name', value)}
            onBlur={blur}
            error={errors.name}
            placeholder={`例如：${provider?.label ?? '语音服务'}`}
          />
          <ToggleField
            label="启用配置"
            value={draft.enabled}
            onValueChange={(value) => set('enabled', value, true)}
          />
          <InputField
            label={provider?.credentialLabel ?? 'API Key'}
            value={draft.apiKey}
            onChangeText={(value) => set('apiKey', value)}
            onBlur={blur}
            error={errors.apiKey}
            autoCapitalize="none"
            autoCorrect={false}
            autoGrow
          />
          {provider && draft.preserveEndpoint && draft.provider !== 'openaiCompatible' ? (
            <View>
              <Text style={{ color: theme.colors.text.secondary }}>
                此配置保留原服务地址：{draft.baseUrl}
              </Text>
              <Button
                title="改用官方地址"
                variant="text"
                onPress={() => set('preserveEndpoint', false, true)}
              />
            </View>
          ) : null}
          {draft.provider === 'openaiCompatible' ? (
            <InputField
              label="API 地址"
              value={draft.baseUrl}
              onChangeText={(value) => set('baseUrl', value)}
              onBlur={blur}
              error={errors.baseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="https://example.com/v1"
            />
          ) : null}
          {provider && ['openrouter', 'elevenlabs'].includes(provider.id) ? (
            <Button
              title={loadingOptions ? '加载官方目录…' : '加载官方模型与音色'}
              disabled={loadingOptions}
              variant="text"
              onPress={() => {
                void loadOptions();
              }}
            />
          ) : null}
          {optionsError ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error }}>
              {optionsError}
            </Text>
          ) : null}
          {provider ? (
            provider.models.length ? (
              <DropdownField
                label="模型"
                value={draft.model}
                options={modelOptions}
                onChange={(value) => setModel(value, true)}
                error={errors.model}
              />
            ) : (
              <InputField
                label="模型"
                value={draft.model}
                onChangeText={setModel}
                onBlur={blur}
                error={errors.model}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )
          ) : null}
          {options?.voices.length ? (
            <DropdownField
              label="从官方音色库选择"
              value={String(draft.voiceId)}
              options={options.voices}
              onChange={(value) => set('voiceId', value, true)}
            />
          ) : null}
          {fields
            .filter((field) => !field.advanced || advanced)
            .map((field) => (
              <View key={`${draft.provider}:${field.key}`} onLayout={feedback.fieldLayout([field.key])}>
                {field.type === 'select' ? (
                  <DropdownField
                    label={field.label}
                    value={String(draft[field.key] ?? '')}
                    options={[
                      ...(!field.required ? [{ value: '', label: '使用服务默认值' }] : []),
                      ...field.options!.map((value) => ({
                        value,
                        label:
                          (
                            {
                              auto: '自动',
                              china: '国内站',
                              international: '国际站',
                              us: '美国西部',
                              beijing: '北京',
                              singapore: '新加坡',
                              happy: '高兴',
                              sad: '悲伤',
                              calm: '平静',
                              angry: '生气',
                              fearful: '害怕',
                              disgusted: '厌恶',
                              surprised: '惊讶',
                              fluent: '生动',
                              whisper: '低语',
                              whispers: '低语',
                              excited: '兴奋',
                              curious: '好奇',
                              sarcastic: '讽刺',
                              crying: '哭泣',
                              laughs: '笑',
                              sighs: '叹气',
                            } as Record<string, string>
                          )[value] ?? value,
                      })),
                    ]}
                    error={errors[field.key]}
                    onChange={(value) => set(field.key, value, true)}
                  />
                ) : field.type === 'boolean' ? (
                  <ToggleField
                    label={field.label}
                    value={draft[field.key] === true}
                    onValueChange={(value) => set(field.key, value, true)}
                  />
                ) : (
                  <InputField
                    label={field.label}
                    value={String(draft[field.key] ?? '')}
                    onChangeText={(value) => set(field.key, value)}
                    onBlur={blur}
                    error={errors[field.key]}
                    hint={
                      field.hint ??
                      (field.type === 'number'
                        ? `留空使用服务默认值；范围 ${field.min}～${field.max}`
                        : undefined)
                    }
                    keyboardType={field.type === 'number' ? 'numeric' : 'default'}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline={field.key === 'instructions'}
                  />
                )}
              </View>
            ))}
          {fields.some((field) => field.advanced) ? (
            <TouchableOpacity onPress={() => setAdvanced(!advanced)}>
              <Text style={{ color: theme.colors.text.secondary, paddingVertical: theme.spacing.md }}>
                {advanced ? '收起高级参数' : '展开高级参数'}
              </Text>
            </TouchableOpacity>
          ) : null}
          <SpeechConfigurationTest
            kind={kind}
            getConfiguration={getConfiguration}
            configurationRevision={JSON.stringify(draft)}
          />
          {testError ? (
            <Text accessibilityRole="alert" style={{ color: theme.colors.feedback.error }}>
              {testError}
            </Text>
          ) : null}
          {modelId ? <Button title="删除配置" variant="danger" onPress={remove} /> : null}
        </ScrollView>
      </KeyboardAvoidingContainer>
    </SafeAreaView>
  );
}
