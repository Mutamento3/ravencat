/** 时刻设置路由：独立 push 页面，退出即返回时刻列表。 */
import { useRouter } from 'expo-router';
import { MomentsSettingsView } from '@features/moments';

export default function MomentsSettingsRoute() {
  const router = useRouter();
  return <MomentsSettingsView onClose={() => router.back()} />;
}
