/** 其他任务提示词复用独立列表与正文编辑路由。 */
import PromptCenterRouteContent from '@host/navigation/PromptCenterRouteContent';

export default function OtherPromptsRoute() {
  return <PromptCenterRouteContent page={{ kind: 'other' }} />;
}
