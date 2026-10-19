import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useThemedStyles } from '@shared/theme';
import { Button, InputField } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { useAutoSaveDraft } from '@shared/ui/useAutoSaveDraft';
import { AutoSaveErrors } from '@shared/ui/AutoSaveErrors';
import { updateCurrentUserProfile } from '../composition';
import type { UserProfile } from '../domain/UserProfile';
import type { UserProfileField } from '../domain/UserProfileField';
import type { ProfileNavigationState } from './ProfileDetailsScreen';
import { parseProfileFieldDraft, PROFILE_FIELD_LABELS, profileFieldValue } from './profileFieldDraft';
import { useCurrentUserProfile } from './useCurrentUserProfile';
import { createProfileDetailsStyles } from './ProfileDetails.styles';

interface Props {
  field: UserProfileField;
  onBack(): void;
  onNavigationStateChange(state: ProfileNavigationState): void;
}
const PLACEHOLDERS: Record<UserProfileField, string> = {
  name: '填写你的用户名', gender: '自由填写，例如女、男、霸王龙', age: '填写非负整数，也可以留空',
  identity: '例如学生、设计师，或你设定的角色身份', region: '填写你所在或设定的地区',
  other: '补充你的设定，例如家里有几口人、性格、喜好和生活背景', signature: '写下一句你喜欢的个性语录',
};

function ProfileFieldEditor({ field, profile, onBack, onNavigationStateChange }: Props & { profile: UserProfile }) {
  const styles = useThemedStyles(createProfileDetailsStyles);
  const [blocked, setBlocked] = useState(false);
  const initial = useMemo(() => ({ value: profileFieldValue(profile, field) }), [profile, field]);
  const editor = useAutoSaveDraft({ initial, parse: (draft, changed) => parseProfileFieldDraft(field, draft, changed),
    save: async (patch) => { await updateCurrentUserProfile(patch); } });
  const { flush: flushDraft, dirty } = editor;
  const flush = useCallback(async () => {
    const saved = await flushDraft();
    setBlocked(!saved);
    return saved;
  }, [flushDraft]);
  useEffect(() => { onNavigationStateChange({ dirty, flush }); }, [dirty, flush, onNavigationStateChange]);
  return <>
    <NavigationHeader title={PROFILE_FIELD_LABELS[field]} onGoBack={onBack} />
    <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.editor}>
      <InputField value={editor.draft.value} onChangeText={(value) => editor.change({ value })}
        onBlur={() => void editor.commit()} error={editor.errors.value} placeholder={PLACEHOLDERS[field]}
        maxLength={field === 'name' ? 20 : undefined} keyboardType={field === 'age' ? 'number-pad' : 'default'}
        autoGrow={field === 'other' || field === 'identity' || field === 'signature'}
        hint="离开输入框时自动保存，返回时会完成保存。" />
      <AutoSaveErrors error={editor.saveError} blocked={blocked && !!editor.errors.value}
        retry={() => void flush()} restore={() => { void editor.restore().then(() => setBlocked(false)); }} />
    </ScrollView>
  </>;
}

export function ProfileFieldScreen(props: Props) {
  const styles = useThemedStyles(createProfileDetailsStyles);
  const { profile, error, reload } = useCurrentUserProfile();
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
    {profile ? <ProfileFieldEditor key={props.field} {...props} profile={profile} /> : <>
      <NavigationHeader title={PROFILE_FIELD_LABELS[props.field]} onGoBack={props.onBack} />
      {error ? <View style={styles.loading}><Text style={styles.loadingError}>{error}</Text><Button title="重试" onPress={reload} /></View>
        : <ActivityIndicator style={styles.loading} />}
    </>}
  </SafeAreaView>;
}
