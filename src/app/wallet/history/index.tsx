/** 羽库历史列表路由。 */
import { useState } from 'react';
import { type Href, useRouter } from 'expo-router';
import {
  encodeWalletHistoryRangeId,
  WalletHistoryScreen,
  type ViewType,
} from '@features/wallet';

export default function WalletHistoryRoute() {
  const router = useRouter();
  const [view, setView] = useState<ViewType>('month');

  return (
    <WalletHistoryScreen
      initialView={view}
      onBack={() => router.back()}
      onViewChange={setView}
      onSelectTimeRange={(timeRange) => {
        router.push(`/wallet/history/${encodeWalletHistoryRangeId(timeRange)}` as Href);
      }}
    />
  );
}
