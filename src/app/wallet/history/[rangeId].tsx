/** 羽库历史详情路由，只通过 rangeId 还原查询范围。 */
import { Redirect, type Href, useLocalSearchParams, useRouter } from 'expo-router';
import {
  decodeWalletHistoryRangeId,
  WalletHistoryDetailScreen,
} from '@features/wallet';

export default function WalletHistoryDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ rangeId?: string | string[] }>();
  const rawRangeId = Array.isArray(params.rangeId) ? params.rangeId[0] : params.rangeId;
  const timeRange = rawRangeId ? decodeWalletHistoryRangeId(rawRangeId) : null;

  if (!timeRange) {
    return <Redirect href={'/wallet/history' as Href} />;
  }

  return <WalletHistoryDetailScreen timeRange={timeRange} onBack={() => router.back()} />;
}
