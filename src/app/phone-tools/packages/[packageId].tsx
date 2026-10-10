/** 通用 Phone Tool Package 详情路由适配。 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { ToolPackageScreen } from '@features/miniPrograms';

export default function ToolPackageRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ packageId?: string | string[] }>();
  const packageId = Array.isArray(params.packageId)
    ? params.packageId[0]
    : params.packageId;

  return <ToolPackageScreen packageId={packageId} onBack={() => router.back()} />;
}
