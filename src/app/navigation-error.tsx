/** 外部导航目标失效时的明确回退页。 */
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState } from '@shared/ui';

const ERROR_COPY = {
  'assistant-not-found': ['找不到这个 AI', 'AI 可能已被删除，或通知已经失效。'],
  'session-not-found': ['找不到这个会话', '会话可能已被删除，或不属于通知中的 AI。'],
  'call-not-found': ['找不到这次通话', '通话记录可能已被删除，或来电通知已经失效。'],
  'group-not-found': ['找不到这个群聊', '群聊可能已被删除，或通知已经失效。'],
} as const;

type NavigationErrorReason = keyof typeof ERROR_COPY;

export default function NavigationErrorRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ reason?: string | string[] }>();
  const rawReason = Array.isArray(params.reason) ? params.reason[0] : params.reason;
  const reason: NavigationErrorReason = rawReason && rawReason in ERROR_COPY
    ? rawReason as NavigationErrorReason
    : 'session-not-found';
  const [title, description] = ERROR_COPY[reason];

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <EmptyState
        title={title}
        description={description}
        actionText="返回会话列表"
        onAction={() => router.dismissTo('/conversations' as Href)}
      />
    </SafeAreaView>
  );
}
