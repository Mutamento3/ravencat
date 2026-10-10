/** 列表与编辑页共享 URL 前缀，由根 Stack 管理返回层级。 */
import PromptCenterRouteContent from '@host/navigation/PromptCenterRouteContent';

export default function CustomPromptsRoute() {
  return <PromptCenterRouteContent page={{ kind: 'custom' }} />;
}
