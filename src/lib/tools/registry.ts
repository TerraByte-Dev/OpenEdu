// Tool registry — the kernel's single lookup point. Tools self-register here; the kernel
// calls list(ctx) to get the subset enabled for the current turn (filtered by isEnabled,
// which the permission layer and active skills will gate in later phases).
//
// Phase 0: starts EMPTY. The first real tools land in Phase 1 (knowledge.update_map,
// progress.mark_mastered, ask_user.question).

import type { EduTool, ToolContext } from "./EduTool";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous tool storage
type AnyTool = EduTool<any, any>;

class ToolRegistry {
  private tools = new Map<string, AnyTool>();

  register(tool: AnyTool): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool "${tool.name}" is already registered`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  all(): AnyTool[] {
    return [...this.tools.values()];
  }

  // The enabled subset for this turn. isEnabled may be async (permission checks, skill gating).
  async list(ctx: ToolContext): Promise<AnyTool[]> {
    const enabled: AnyTool[] = [];
    for (const tool of this.tools.values()) {
      if (await tool.isEnabled(ctx)) enabled.push(tool);
    }
    return enabled;
  }

  clear(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();
export type { ToolRegistry };
