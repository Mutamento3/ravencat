/** 条件提示词独立进入原生路由栈，业务分组由 Prompting 管理。 */
import PromptCenterRouteContent from '@host/navigation/PromptCenterRouteContent';

export default function ConditionalPromptsRoute() {
  return <PromptCenterRouteContent page={{ kind: 'conditional' }} />;
}
