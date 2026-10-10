import { useRef, useState } from 'react';
import { useNavigation, useRouter } from 'expo-router';
import { usePreventRemove } from '@react-navigation/native';
import { ProfileDetailsScreen, ProfileFieldScreen, type ProfileNavigationState, type UserProfileField } from '@features/profile';

/** 按钮、Android 返回与系统返回手势等待同一份提交，Feature 不执行路由动作。 */
export default function ProfileRouteContent({ field }: { field?: UserProfileField }) {
  const router = useRouter();
  const navigation = useNavigation();
  const [state, setState] = useState<ProfileNavigationState | null>(null);
  const leaving = useRef(false);
  usePreventRemove(state?.dirty ?? false, ({ data }) => {
    if (leaving.current) return;
    leaving.current = true;
    void state!.flush().then((saved) => { if (saved) navigation.dispatch(data.action); })
      .finally(() => { leaving.current = false; });
  });
  const common = { onBack: () => router.back(), onNavigationStateChange: setState };
  return field ? <ProfileFieldScreen {...common} field={field} />
    : <ProfileDetailsScreen {...common} onOpenField={(next) => router.push({ pathname: '/profile/[field]', params: { field: next } })} />;
}
