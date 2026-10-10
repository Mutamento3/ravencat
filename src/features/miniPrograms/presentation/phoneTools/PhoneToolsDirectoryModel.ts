import type {
  PhoneToolCatalogItem,
  PhoneToolCategory,
} from '@features/phoneTools';

export type PhoneToolDirectoryDestination = 'usageAccessSettings';

export interface PhoneToolDirectoryItem extends PhoneToolCatalogItem {
  destination: PhoneToolDirectoryDestination | null;
}

export interface PhoneToolDirectorySection {
  id: PhoneToolCategory;
  title: string;
  items: PhoneToolDirectoryItem[];
}

interface PhoneToolCategoryDefinition {
  id: PhoneToolCategory;
  title: string;
}

function resolveDestination(
  item: PhoneToolCatalogItem,
): PhoneToolDirectoryDestination | null {
  if (item.toolName === 'get_app_usage') return 'usageAccessSettings';
  return null;
}

export function buildPhoneToolsDirectory(
  catalog: readonly PhoneToolCatalogItem[],
  categories: readonly PhoneToolCategoryDefinition[],
): PhoneToolDirectorySection[] {
  return categories.map((category) => ({
    ...category,
    items: catalog
      .filter((item) => item.category === category.id)
      .map((item) => ({ ...item, destination: resolveDestination(item) })),
  }));
}
