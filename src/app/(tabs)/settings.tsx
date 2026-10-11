/** 设置 Tab。 */
import { type Href, useRouter } from 'expo-router';
import { useChatRouter } from '@features/chat';
import { ProfileTab } from '@features/profile';
import { useApplicationUpdates } from '@host/shell/ApplicationUpdateProvider';

export default function SettingsRoute() {
  const router = useRouter();
  const { resetApplicationData } = useChatRouter();
  const updates = useApplicationUpdates();
  return (
    <ProfileTab
      onOpenProfile={() => router.push('/profile')}
      onOpenBackup={() => router.push('/backup' as Href)}
      onClearData={resetApplicationData}
      checkingUpdates={updates.checking || (updates.download !== null && updates.download.uri === null)}
      availableUpdateVersion={updates.available?.version ?? null}
      updateProgress={updates.download && !updates.download.uri ? updates.download.progress : null}
      updateDownloaded={Boolean(updates.download?.uri)}
      onCheckUpdates={updates.checkManually}
    />
  );
}
