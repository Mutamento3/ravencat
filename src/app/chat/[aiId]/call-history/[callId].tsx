import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { CallHistoryDetailScreen } from '@features/calls';

export default function CallHistoryDetailRoute() {
  const { aiId, callId } = useLocalSearchParams<{ aiId: string; callId: string }>();
  const router = useRouter();
  return aiId && callId ? <CallHistoryDetailScreen assistantId={aiId} callId={callId} onBack={() => router.back()} />
    : <Redirect href="/conversations" />;
}
