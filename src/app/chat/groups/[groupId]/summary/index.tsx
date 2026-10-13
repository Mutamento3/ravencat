/** 群摘要与子页面的具体地址由 App 持有。 */
import { Redirect, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { GroupSummaryRouteScreen } from '@features/chat';

export default function GroupSummaryRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ groupId?: string | string[]; view?: string | string[]; segmentId?: string | string[]; taskId?: string | string[] }>();
  const groupId = Array.isArray(params.groupId) ? params.groupId[0] : params.groupId;
  const view = Array.isArray(params.view) ? params.view[0] : params.view;
  const segmentId = Array.isArray(params.segmentId) ? params.segmentId[0] : params.segmentId;
  const taskId = Array.isArray(params.taskId) ? params.taskId[0] : params.taskId;
  if (!groupId) return <Redirect href={'/conversations' as Href} />;
  const open = (extra: Record<string, string> = {}) => router.push({ pathname: `/chat/groups/${encodeURIComponent(groupId)}/summary`, params: extra } as Href);
  return <GroupSummaryRouteScreen key={`${groupId}:${view ?? 'list'}:${segmentId ?? taskId ?? ''}`} groupId={groupId}
    view={view === 'settings' || view === 'secondary' || view === 'edit' ? view : undefined}
    segmentId={segmentId} taskId={taskId} onBack={() => router.back()}
    onCreateSummary={() => open({ view: 'edit' })} onEditSummary={(segmentId) => open({ view: 'edit', segmentId })}
    onEditSecondary={() => open({ view: 'secondary' })} onTask={(taskId) => open({ view: 'edit', taskId })}
    onSettings={() => open({ view: 'settings' })} />;
}
