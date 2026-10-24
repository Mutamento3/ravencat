import { Redirect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { CallHistoryScreen } from '@features/calls';

export default function CallHistoryRoute() {
  const { aiId } = useLocalSearchParams<{ aiId: string }>();
  const router = useRouter();
  return aiId ? <CallHistoryScreen assistantId={aiId} onBack={() => router.back()}
    onOpenRecord={callId => router.push({ pathname: `/chat/${encodeURIComponent(aiId)}/call-history/${encodeURIComponent(callId)}` } as Href)} />
    : <Redirect href="/conversations" />;
}
