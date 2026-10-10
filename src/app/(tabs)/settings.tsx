/** 设置 Tab。 */
import { type Href, useRouter } from 'expo-router';
import { useChatRouter } from '@features/chat';
import { ProfileTab } from '@features/profile';

export default function SettingsRoute() {
  const router = useRouter();
  const { resetApplicationData } = useChatRouter();
  return (
    <ProfileTab
      onOpenProfile={() => router.push('/profile')}
      onOpenBackup={() => router.push('/backup' as Href)}
      onClearData={resetApplicationData}
    />
  );
}
