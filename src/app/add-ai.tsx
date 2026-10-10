/** 添加 AI 路由。 */
import { useRouter } from 'expo-router';
import { AddAIScreen } from '@features/assistants';
import { useChatRouter } from '@features/chat';

export default function AddAIRoute() {
  const router = useRouter();
  const { state } = useChatRouter();
  return (
    <AddAIScreen
      onBack={() => router.back()}
      onAdded={() => {
        void state.loadAIAssistants();
      }}
    />
  );
}
