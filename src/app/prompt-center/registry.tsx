/** 身份池名单为全局提示词配置，不绑定当前编辑的 AI。 */
import PromptCenterRouteContent from '@host/navigation/PromptCenterRouteContent';

export default function PromptAgentRegistryRoute() {
  return <PromptCenterRouteContent page={{ kind: 'registry' }} />;
}
