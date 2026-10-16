/** 小程序 Tab。 */
import { type Href, useRouter } from 'expo-router';
import { MiniProgramsTab } from '@features/miniPrograms';

const MINI_PROGRAM_ROUTES: Record<string, Href> = {
  wallet: '/wallet',
  auxiliaryModels: '/auxiliary-models',
  mcpTools: '/mcp-tools',
  webSearch: '/web-search' as Href,
  memory: '/memory' as Href,
  promptCenter: '/prompt-center' as Href,
  ravenCatCompanion: '/raven-cat',
  ravenCatFloating: '/raven-cat/floating-interaction' as Href,
  ravenCatSystemAccess: '/raven-cat/system-access' as Href,
  phoneTools: '/phone-tools' as Href,
  stickerSystem: '/sticker-system' as Href,
  appearance: '/appearance',
};

export default function MiniProgramsRoute() {
  const router = useRouter();
  return (
    <MiniProgramsTab
      onOpenApp={(appId) => {
        const route = MINI_PROGRAM_ROUTES[appId];
        if (route) {
          router.push(route);
        }
      }}
    />
  );
}
