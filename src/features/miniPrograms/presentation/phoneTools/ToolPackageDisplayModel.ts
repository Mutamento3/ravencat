import type {
  PhoneToolPackage,
  PhoneToolPackageStatus,
} from '@features/phoneTools';

export interface ToolPackageDisplayTool {
  id: string;
  toolName: string;
  title: string;
  description: string;
  implementationStatus: PhoneToolPackageStatus;
  statusLabel: string;
}

export interface ToolPackageDisplayModel {
  id: string;
  title: string;
  description: string;
  implementationStatus: PhoneToolPackageStatus;
  statusLabel: string;
  tools: ToolPackageDisplayTool[];
}

export function getToolPackageStatusLabel(status: PhoneToolPackageStatus): string {
  return status === 'available' ? '可使用' : '开发中';
}

export function buildToolPackageDisplayModel(
  toolPackage: PhoneToolPackage,
): ToolPackageDisplayModel {
  return {
    ...toolPackage,
    statusLabel: getToolPackageStatusLabel(toolPackage.implementationStatus),
    tools: toolPackage.tools.map((tool) => ({
      ...tool,
      statusLabel: getToolPackageStatusLabel(tool.implementationStatus),
    })),
  };
}
