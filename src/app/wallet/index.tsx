/** 羽库主路由。 */
import { type Href, useRouter } from 'expo-router';
import { WalletScreen } from '@features/wallet';

export default function WalletRoute() {
  const router = useRouter();
  return <WalletScreen onOpenHistory={() => router.push('/wallet/history' as Href)} />;
}
