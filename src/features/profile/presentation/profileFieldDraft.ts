import type { DraftCommit } from '@shared/ui/AutoSaveDraftEditor';
import type { UpdateUserProfileInput, UserProfile } from '../domain/UserProfile';
import type { UserProfileField } from '../domain/UserProfileField';

export const PROFILE_FIELD_LABELS: Record<UserProfileField, string> = {
  name: '用户名', gender: '性别', age: '年龄', identity: '身份', region: '地区', other: '其他', signature: '签名',
};

export function profileFieldValue(profile: UserProfile, field: UserProfileField): string {
  return field === 'age' ? profile.age === null ? '' : String(profile.age) : profile[field];
}

export function parseProfileFieldDraft(field: UserProfileField, draft: { value: string }, changed: 'value'[]): DraftCommit<{ value: string }, UpdateUserProfileInput> {
  if (changed.length === 0) return { patch: {}, accepted: [], errors: {} };
  const value = draft.value.trim();
  let error: string | undefined;
  if (field === 'name' && !value) error = '用户名不能为空。';
  if (field === 'name' && value.length > 20) error = '用户名最多 20 个字符。';
  if (field === 'age' && value && (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)))) {
    error = '年龄请填写非负整数，或留空；不能包含文字、小数或特殊字符。';
  }
  if (error) return { patch: {}, accepted: [], errors: { value: error } };
  return {
    patch: { [field]: field === 'age' ? value ? Number(value) : null : field === 'other' && value ? draft.value : value },
    accepted: ['value'], errors: {},
  };
}
