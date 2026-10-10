/** 群聊文件预览路由；复用聊天 Feature 的统一文件预览能力。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { GroupFilePreviewRouteScreen } from '@features/chat';

export default function GroupFilePreviewRoute() {
  const params = useLocalSearchParams<{ groupId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  return groupId
    ? <GroupFilePreviewRouteScreen groupId={groupId} />
    : <Redirect href={'/conversations' as Href} />;
}
