// 自定义 Expo Router 入口：先注册后台运行时，再交由 Router 注册根组件。

// 必须最先导入 gesture handler
import 'react-native-gesture-handler';

import { AppRegistry } from 'react-native';
import {
  runCompanionWakeHeadlessTask,
} from '@features/companion';
import { runFloatingMessageHeadlessTask } from '@features/floatingLayer';
import {
  configureCompanionHeadlessRuntime,
  runCallNotificationActionHeadlessTask,
  runConversationTurnHeadlessTask,
  runHostRelationshipReplyHeadlessTask,
  runCallExecutionHeadlessTask,
  runTogetherListeningNotificationActionHeadlessTask,
} from '@host';

configureCompanionHeadlessRuntime();
AppRegistry.registerHeadlessTask('RavenCatCompanionWakeTask', () => runCompanionWakeHeadlessTask);
AppRegistry.registerHeadlessTask('RavenCatFloatingMessageTask', () => runFloatingMessageHeadlessTask);
AppRegistry.registerHeadlessTask('ConversationTurnExecutionTask', () => runConversationTurnHeadlessTask);
AppRegistry.registerHeadlessTask('HostRelationshipReplyTask', () => runHostRelationshipReplyHeadlessTask);
AppRegistry.registerHeadlessTask('RavenCatCallExecutionTask', () => runCallExecutionHeadlessTask);
AppRegistry.registerHeadlessTask(
  'KimiPhoneCallNotificationActionTask',
  () => runCallNotificationActionHeadlessTask
);
AppRegistry.registerHeadlessTask(
  'KimiPhoneTogetherListeningNotificationActionTask',
  () => runTogetherListeningNotificationActionHeadlessTask
);

// 必须最后加载，确保后台任务与运行时先于路由根组件完成注册。
require('expo-router/entry');
