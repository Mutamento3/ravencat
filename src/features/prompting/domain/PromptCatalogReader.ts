/** 定义提示词中心读取代码内置目录所需的只读端口。 */

import type { PromptDefinitionDescriptor } from '@shared/prompt';

export interface PromptCatalogReader {
  list(): readonly PromptDefinitionDescriptor[];
  getById(definitionId: string): PromptDefinitionDescriptor | null;
}
