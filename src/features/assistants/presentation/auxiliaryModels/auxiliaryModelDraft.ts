/** 辅助模型输入转换；关联 metadata 整组提交，其余字段独立校验和更新。 */
import type { AuxiliaryModelConfig, CapabilityKind, UpdateAuxiliaryModelConfigInput } from '../../domain/AuxiliaryModel';
import type { DraftCommit, DraftErrors } from '@shared/ui/AutoSaveDraftEditor';
import { readDraftNumber, readDraftInteger } from '@shared/ui/draftValidation';
import {
  getDefaultAuxiliaryTaskPrompt, readAuxiliaryTaskPromptOverride, writeAuxiliaryTaskPromptOverride,
} from '@shared/prompt';
export interface AuxiliaryModelDraft {
  name: string; enabled: boolean; baseUrl: string; apiKey: string; model: string;
  taskPrompt: string; usesDefaultTaskPrompt: boolean;
  tempInput: string; topPInput: string; maxTokens: string;
  rawMetadata: string | null;
}
export const metadataKeys = ['taskPrompt', 'usesDefaultTaskPrompt', 'rawMetadata'];
export function getAuxiliaryModelDraft(kind: CapabilityKind, data: AuxiliaryModelConfig | null): AuxiliaryModelDraft {
  const override = readAuxiliaryTaskPromptOverride(data?.metadataJson);
  return {
    name: data?.name ?? '', enabled: data?.enabled ?? true,
    baseUrl: data?.baseUrl ?? '',
    apiKey: data?.apiKey ?? '', model: data?.model ?? '',
    taskPrompt: kind === 'ocr' ? override ?? getDefaultAuxiliaryTaskPrompt('ocr') : '',
    usesDefaultTaskPrompt: !override, tempInput: data?.temperature == null ? '' : String(data.temperature),
    topPInput: data?.topP == null ? '' : String(data.topP), maxTokens: data?.maxTokens == null ? '' : String(data.maxTokens),
    rawMetadata: data?.metadataJson ?? null,
  };
}
export function parseAuxiliaryModelDraft(kind: CapabilityKind, draft: AuxiliaryModelDraft, changed: (keyof AuxiliaryModelDraft)[]): DraftCommit<AuxiliaryModelDraft, UpdateAuxiliaryModelConfigInput> {
  const patch: UpdateAuxiliaryModelConfigInput = {};
  const errors: DraftErrors<AuxiliaryModelDraft> = {};
  const accepted: (keyof AuxiliaryModelDraft)[] = [];
  const group = changed.filter((key) => metadataKeys.includes(key));
  const labels = { name: '配置名称', baseUrl: 'API 地址', model: '模型名称' };
  for (const key of changed) {
    if (metadataKeys.includes(key)) continue;
    if (key === 'name' || key === 'baseUrl' || key === 'model') {
      if (!draft[key].trim()) { errors[key] = `${labels[key]}不能为空；这次修改尚未保存。`; continue; }
      patch[key] = draft[key].trim();
    } else if (key === 'apiKey') {
      patch.apiKey = draft.apiKey.trim() || null;
    } else if (key === 'enabled') {
      patch.enabled = draft.enabled;
    } else if (key === 'tempInput' || key === 'topPInput') {
      if (kind === 'embedding') continue;
      const parsed = readDraftNumber(draft[key], key === 'tempInput' ? 'Temperature' : 'Top P', 0, key === 'tempInput' ? 2 : 1, true);
      if (parsed.error) { errors[key] = parsed.error; continue; }
      patch[key === 'tempInput' ? 'temperature' : 'topP'] = parsed.value;
    } else if (key === 'maxTokens') {
      if (kind === 'embedding') continue;
      const parsed = draft.maxTokens === '无限制'
        ? { value: null, error: null } : readDraftInteger(draft.maxTokens, 'Max Tokens', true);
      if (parsed.error) { errors[key] = parsed.error; continue; }
      patch.maxTokens = parsed.value;
    }
    accepted.push(key);
  }
  if (group.length > 0) {
    const groupErrors: DraftErrors<AuxiliaryModelDraft> = {};
    let metadataJson: string | null = draft.rawMetadata;
    if (kind === 'ocr') {
      if (!draft.usesDefaultTaskPrompt && !draft.taskPrompt.trim()) groupErrors.taskPrompt = '任务说明不能为空；可使用“恢复内置”。这次修改尚未保存。';
      metadataJson = writeAuxiliaryTaskPromptOverride({ rawMetadata: draft.rawMetadata, promptOverride: draft.usesDefaultTaskPrompt ? null : draft.taskPrompt });
    }
    Object.assign(errors, groupErrors);
    if (Object.keys(groupErrors).length === 0) {
      patch.metadataJson = metadataJson;
      accepted.push(...group);
    }
  }
  return { patch, accepted, errors };
}
