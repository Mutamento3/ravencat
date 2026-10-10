/** 群聊管理员设置路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { GroupAdminSettingsRouteScreen } from '@features/chat';

export default function GroupAdminSettingsRoute() {
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  return groupId
    ? <GroupAdminSettingsRouteScreen groupId={groupId} />
    : <Redirect href={'/conversations' as Href} />;
}
