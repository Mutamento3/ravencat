import type {
  PhoneToolCatalogItem,
  PhoneToolCategory,
} from '@features/phoneTools';

export interface PhoneToolDirectorySection {
  id: PhoneToolCategory;
  title: string;
  items: PhoneToolCatalogItem[];
}

interface PhoneToolCategoryDefinition {
  id: PhoneToolCategory;
  title: string;
}

export function buildPhoneToolsDirectory(
  catalog: readonly PhoneToolCatalogItem[],
  categories: readonly PhoneToolCategoryDefinition[],
): PhoneToolDirectorySection[] {
  return categories.map((category) => ({
    ...category,
    items: catalog
      .filter((item) => item.category === category.id),
  }));
}
