import { useLocalSearchParams } from 'expo-router';
import PromptCenterRouteContent from '@host/navigation/PromptCenterRouteContent';

export default function PromptToolPackageRoute() {
  const { packageId } = useLocalSearchParams<{ packageId: string }>();
  return <PromptCenterRouteContent page={{ kind: 'package', id: packageId }} />;
}
