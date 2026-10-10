/** 辅助模型配置列表路由。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { AuxiliaryModelsRouteContent, parseCapabilityKind } from '@host';

export default function AuxiliaryModelPoolRoute() {
  const params = useLocalSearchParams<{ kind?: string | string[] }>();
  const rawKind = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const kind = parseCapabilityKind(rawKind);
  if (!kind) {
    return <Redirect href={'/auxiliary-models' as Href} />;
  }
  return <AuxiliaryModelsRouteContent route={{ screen: 'pool', kind }} />;
}
