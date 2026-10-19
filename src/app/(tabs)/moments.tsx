/**
 * 朋友圈 Tab。
 * 发布与时刻设置是独立 push 路由；本页保活，返回（含从其他 Tab 切回）时按
 * refreshRevision 重载动态窗口；封面等资料由 Profile 更新事件同步。
 */
import { type Href, useRouter } from 'expo-router';
import { MomentsTab } from '@features/moments';
import { useRetainedRouteRefreshRevision } from '@host';

export default function MomentsRoute() {
  const router = useRouter();
  const refreshRevision = useRetainedRouteRefreshRevision();

  return (
    <MomentsTab
      refreshRevision={refreshRevision}
      onPublishPress={() => router.push('/moments/publish' as Href)}
      onSettingsPress={() => router.push('/moments/settings' as Href)}
    />
  );
}
