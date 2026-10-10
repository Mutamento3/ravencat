import { useLocalSearchParams } from 'expo-router';
import PromptCenterRouteContent from '@host/navigation/PromptCenterRouteContent';

export default function CustomPromptEditorRoute() {
  const { promptId } = useLocalSearchParams<{ promptId: string }>();
  return <PromptCenterRouteContent page={{ kind: 'userEditor', promptId }} />;
}
