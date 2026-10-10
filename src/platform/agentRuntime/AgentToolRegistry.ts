/** 提供无业务依赖的 Agent 工具注册、查询和允许列表校验。 */
import type { AgentTool, AgentToolDescriptor } from '@shared/aiTools';

export class AgentToolRegistry {
  private readonly tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    if (this.tools.has(tool.descriptor.name)) {
      throw new Error(`Agent tool already registered: ${tool.descriptor.name}`);
    }

    this.tools.set(tool.descriptor.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name);
  }

  list(): AgentToolDescriptor[] {
    return Array.from(this.tools.values(), (tool) => tool.descriptor);
  }

  listAllowed(names: readonly string[]): AgentToolDescriptor[] {
    return names.map((name) => {
      const tool = this.tools.get(name);
      if (!tool) {
        throw new Error(`Unknown allowed Agent tool: ${name}`);
      }
      return tool.descriptor;
    });
  }
}
