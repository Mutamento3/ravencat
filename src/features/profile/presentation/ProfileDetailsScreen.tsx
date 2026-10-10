import React, { useEffect } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedSurface, useThemedStyles } from '@shared/theme';
import { Button, UserAvatar } from '@shared/ui';
import NavigationHeader from '@shared/ui/NavigationHeader';
import { AutoSaveErrors } from '@shared/ui/AutoSaveErrors';
import { USER_PROFILE_FIELDS, type UserProfileField } from '../domain/UserProfileField';
import type { UserProfile } from '../domain/UserProfile';
import { PROFILE_FIELD_LABELS, profileFieldValue } from './profileFieldDraft';
import { useCurrentUserProfile } from './useCurrentUserProfile';
import { useProfileAvatar } from './useProfileAvatar';
import { createProfileDetailsStyles } from './ProfileDetails.styles';

/** Feature 只报告待提交状态，Stack 的返回和手势裁决由 Host 装配。 */
export interface ProfileNavigationState { dirty: boolean; flush(): Promise<boolean> }

interface Props {
  onBack(): void;
  onOpenField(field: UserProfileField): void;
  onNavigationStateChange(state: ProfileNavigationState): void;
}

function ProfileDetailsContent({ profile, onBack, onOpenField, onNavigationStateChange }: Props & { profile: UserProfile }) {
  const styles = useThemedStyles(createProfileDetailsStyles);
  const avatar = useProfileAvatar(profile);
  useEffect(() => { onNavigationStateChange({ dirty: avatar.dirty, flush: avatar.flush }); },
    [avatar.dirty, avatar.flush, onNavigationStateChange]);
  return <>
    <NavigationHeader title="个人资料" onGoBack={onBack} />
    <ScrollView contentContainerStyle={styles.content}>
      <ThemedSurface nativeGlass variant="card" style={styles.section}>
        <TouchableOpacity style={styles.row} accessibilityRole="button" accessibilityLabel="修改头像"
          onPress={avatar.onPress} disabled={avatar.busy} activeOpacity={0.7}>
          <Text style={styles.label}>头像</Text>
          <View style={styles.avatar}><UserAvatar name={profile.name} avatarUrl={avatar.avatarUri} size="medium" /></View>
        </TouchableOpacity>
        {USER_PROFILE_FIELDS.map((field) => {
          const value = profileFieldValue(profile, field);
          return <React.Fragment key={field}>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.row} onPress={() => onOpenField(field)} disabled={avatar.busy}
              accessibilityRole="button" accessibilityLabel={`修改${PROFILE_FIELD_LABELS[field]}`} activeOpacity={0.7}>
              <Text style={styles.label}>{PROFILE_FIELD_LABELS[field]}</Text>
              <Text numberOfLines={1} style={[styles.value, !value && styles.emptyValue]}>{value || '未填写'}</Text>
            </TouchableOpacity>
          </React.Fragment>;
        })}
      </ThemedSurface>
      <AutoSaveErrors error={avatar.error} blocked={false} retry={avatar.retry} restore={() => void avatar.restore()} />
      <Text style={styles.note}>填写的个人资料会作为你的人设供 AI 交流时参考。修改自动保存，未填写的项目不会加入人设。</Text>
    </ScrollView>
  </>;
}

export function ProfileDetailsScreen(props: Props) {
  const styles = useThemedStyles(createProfileDetailsStyles);
  const { profile, error, reload } = useCurrentUserProfile();
  return <SafeAreaView style={styles.screen} edges={['top', 'left', 'right', 'bottom']}>
    {profile ? <ProfileDetailsContent {...props} profile={profile} /> : <>
      <NavigationHeader title="个人资料" onGoBack={props.onBack} />
      {error ? <View style={styles.loading}><Text style={styles.loadingError}>{error}</Text><Button title="重试" onPress={reload} /></View>
        : <ActivityIndicator style={styles.loading} />}
    </>}
  </SafeAreaView>;
}
