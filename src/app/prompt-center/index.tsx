/** 无 AI 默认概览和具体 AI 概览共用同一入口。 */
import PromptCenterRouteContent from '@host/navigation/PromptCenterRouteContent';

export default function PromptCenterRoute() {
  return <PromptCenterRouteContent page={{ kind: 'overview' }} />;
}
