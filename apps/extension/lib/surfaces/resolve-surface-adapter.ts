import { getPromptSurface } from "../replit"
import type { SurfaceAdapter } from "./adapter"
import { chatGptSurfaceAdapter } from "./chatgpt/adapter"
import { replitSurfaceAdapter } from "./replit/adapter"

export function resolveSurfaceAdapter(): SurfaceAdapter {
  return getPromptSurface() === "CHATGPT" ? chatGptSurfaceAdapter : replitSurfaceAdapter
}
