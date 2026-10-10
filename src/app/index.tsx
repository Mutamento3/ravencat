/** 根路径只负责把启动目标归一到会话 Tab。 */
import { Redirect } from 'expo-router';

export default function IndexRoute() {
  return <Redirect href="/conversations" />;
}
