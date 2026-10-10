/** 四个应用级 Tab 的 Expo Router 布局。 */
import { Tabs } from 'expo-router';
import { BottomTabBar } from '@features/chat';
import { useHostUnreadCount } from '@host/KimiPhoneHost';

const TAB_ROUTE_IDS: Record<string, string> = {
  conversations: 'ai',
  moments: 'moments',
  'mini-programs': 'apps',
  settings: 'settings',
};

export default function TabsLayout() {
  const unreadCount = useHostUnreadCount();

  return (
    <Tabs
      initialRouteName="conversations"
      backBehavior="initialRoute"
      detachInactiveScreens={false}
      screenOptions={{
        animation: 'fade',
        freezeOnBlur: true,
        headerShown: false,
        lazy: true,
        sceneStyle: { backgroundColor: 'transparent' },
      }}
      tabBar={({ navigation, state }) => (
        <BottomTabBar
          activeTab={TAB_ROUTE_IDS[state.routes[state.index].name]}
          unreadCount={unreadCount}
          onTabChange={(tabId) => {
            const routeName = Object.entries(TAB_ROUTE_IDS)
              .find(([, id]) => id === tabId)?.[0];
            if (routeName) {
              navigation.navigate(routeName);
            }
          }}
        />
      )}
    >
      <Tabs.Screen name="conversations" />
      <Tabs.Screen name="moments" />
      <Tabs.Screen name="mini-programs" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}
