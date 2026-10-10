/** 辅助模型新增或编辑路由，只传模型标识与能力类型。 */
import { Redirect, type Href, useLocalSearchParams } from 'expo-router';
import { AuxiliaryModelsRouteContent, parseCapabilityKind } from '@host';

export default function AuxiliaryModelEditRoute() {
  const params = useLocalSearchParams<{
    kind?: string | string[];
    modelId?: string | string[];
  }>();
  const rawKind = Array.isArray(params.kind) ? params.kind[0] : params.kind;
  const rawModelId = Array.isArray(params.modelId) ? params.modelId[0] : params.modelId;
  const kind = parseCapabilityKind(rawKind);
  if (!kind || !rawModelId) {
    return <Redirect href={'/auxiliary-models' as Href} />;
  }
  return (
    <AuxiliaryModelsRouteContent
      route={{
        screen: 'edit',
        capabilityKind: kind,
        modelId: rawModelId === 'new' ? undefined : rawModelId,
      }}
    />
  );
}
