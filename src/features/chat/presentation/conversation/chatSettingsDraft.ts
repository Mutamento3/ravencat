/** 对话设置的输入边界；只提交合法且实际修改的字段。 */
import type { AIProfile, AIAssistantSettingsUpdate } from '@features/assistants';
import type { DraftCommit } from '@shared/ui/AutoSaveDraftEditor';
import { readDraftInteger } from '@shared/ui/draftValidation';

export interface ContextLimitsDraft {
  privatePrimary: string;
  privateSecondary: string;
  groupPrimary: string;
  groupSecondary: string;
}

export interface ChatSettingsDraft extends ContextLimitsDraft {
  name: string;
  systemPrompt: string;
  allowMultipleBubbles: boolean;
  showTokenUsage: boolean;
}

export function getChatSettingsDraft(ai: AIProfile): ChatSettingsDraft {
  return {
    name: ai.name,
    systemPrompt: ai.systemPrompt ?? '',
    allowMultipleBubbles: ai.allowMultipleBubbles,
    showTokenUsage: ai.showTokenUsage,
    privatePrimary: String(ai.privateContextPrimaryLimit),
    privateSecondary: String(ai.privateContextSecondaryLimit),
    groupPrimary: String(ai.groupContextPrimaryLimit),
    groupSecondary: String(ai.groupContextSecondaryLimit),
  };
}

export function parseChatSettingsDraft(
  draft: ChatSettingsDraft,
  changed: (keyof ChatSettingsDraft)[],
): DraftCommit<ChatSettingsDraft, AIAssistantSettingsUpdate> {
  const result: DraftCommit<ChatSettingsDraft, AIAssistantSettingsUpdate> = { patch: {}, accepted: [], errors: {} };
  const contexts = {
    privatePrimary: 'privateContextPrimaryLimit', privateSecondary: 'privateContextSecondaryLimit',
    groupPrimary: 'groupContextPrimaryLimit', groupSecondary: 'groupContextSecondaryLimit',
  } as const;
  for (const field of changed) {
    if (field === 'name') {
      const name = draft.name.trim();
      if (!name) { result.errors.name = 'AI 名称不能为空；这次修改尚未保存。'; continue; }
      result.patch.name = name;
    } else if (field === 'systemPrompt') {
      result.patch.systemPrompt = draft.systemPrompt;
    } else if (field === 'allowMultipleBubbles') {
      result.patch.allowMultipleBubbles = draft.allowMultipleBubbles;
    } else if (field === 'showTokenUsage') {
      result.patch.showTokenUsage = draft.showTokenUsage;
    } else {
      const parsed = readDraftInteger(draft[field], '上下文条数');
      if (parsed.error) { result.errors[field] = parsed.error; continue; }
      result.patch[contexts[field]] = parsed.value;
    }
    result.accepted.push(field);
  }
  return result;
}
