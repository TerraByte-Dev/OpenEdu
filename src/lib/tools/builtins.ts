// Built-in tool registration. Call once at app init (main.tsx). Idempotent so HMR / repeated
// imports (eval harness + app) don't trip the registry's duplicate guard.

import { toolRegistry } from "./registry";
import { updateMapTool } from "./knowledge/UpdateMapTool";
import { markMasteredTool } from "./progress/MarkMasteredTool";
import { questionTool } from "./ask_user/QuestionTool";
import { searchTool } from "./notebook/SearchTool";
import { ingestTool } from "./notebook/IngestTool";
import { mathRenderTool } from "./math/RenderTool";
import { diagramRenderTool } from "./diagram/RenderTool";
import { librarySearchTool } from "./library/SearchTool";

let registered = false;

export function registerBuiltinTools(): void {
  if (registered) return;
  registered = true;
  toolRegistry.register(updateMapTool);
  toolRegistry.register(markMasteredTool);
  toolRegistry.register(questionTool);
  toolRegistry.register(searchTool);
  toolRegistry.register(ingestTool);
  toolRegistry.register(mathRenderTool);
  toolRegistry.register(diagramRenderTool);
  toolRegistry.register(librarySearchTool);
}
