/** 手机工具小程序路由适配。 */
import { type Href, useRouter } from 'expo-router';
import { PhoneToolsScreen } from '@features/miniPrograms';

export default function PhoneToolsRoute() {
  const router = useRouter();
  return (
    <PhoneToolsScreen
      onBack={() => router.back()}
      onOpenToolPackage={(packageId) => {
        router.push(`/phone-tools/packages/${packageId}` as Href);
      }}
    />
  );
}
