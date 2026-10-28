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
  nickname: string;
  systemPrompt: string;
  allowMultipleBubbles: boolean;
  streamingReply: boolean | null;
  showTokenUsage: boolean;
  showActionSteps: boolean;
}

export function getChatSettingsDraft(ai: AIProfile): ChatSettingsDraft {
  return {
    name: ai.name,
    nickname: ai.nickname ?? '',
    systemPrompt: ai.systemPrompt ?? '',
    allowMultipleBubbles: ai.allowMultipleBubbles,
    streamingReply: ai.streamingReply,
    showTokenUsage: ai.showTokenUsage,
    showActionSteps: ai.showActionSteps,
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
    } else if (field === 'nickname') {
      const nickname = draft.nickname.trim();
      if (Array.from(nickname).length > 20 || /[\r\n]/.test(nickname)) {
        result.errors.nickname = '昵称需为单行，最多20个字符；这次修改尚未保存。'; continue;
      }
      result.patch.nickname = nickname || null;
    } else if (field === 'systemPrompt') {
      result.patch.systemPrompt = draft.systemPrompt;
    } else if (field === 'allowMultipleBubbles') {
      result.patch.allowMultipleBubbles = draft.allowMultipleBubbles;
    } else if (field === 'streamingReply') {
      result.patch.streamingReply = draft.streamingReply;
    } else if (field === 'showTokenUsage') {
      result.patch.showTokenUsage = draft.showTokenUsage;
    } else if (field === 'showActionSteps') {
      result.patch.showActionSteps = draft.showActionSteps;
    } else {
      const guest = field === 'privateSecondary' || field === 'groupSecondary';
      const parsed = readDraftInteger(draft[field], guest ? '背景条数（0 为不带入）' : '当前对话条数', false, guest ? 0 : 1);
      if (parsed.error) { result.errors[field] = parsed.error; continue; }
      result.patch[contexts[field]] = parsed.value;
    }
    result.accepted.push(field);
  }
  return result;
}
