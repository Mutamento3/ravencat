import { useRouter } from 'expo-router';
import { ChatFavoritesScreen } from '@features/chat';

export default function FavoritesRoute() {
  const router = useRouter();
  return <ChatFavoritesScreen onBack={() => router.back()} />;
}
