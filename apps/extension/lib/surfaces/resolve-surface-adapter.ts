import { getPromptSurface } from "../replit"
import type { SurfaceAdapter } from "./adapter"
import { chatGptSurfaceAdapter } from "./chatgpt/adapter"
import { lovableSurfaceAdapter } from "./lovable/adapter"
import { replitSurfaceAdapter } from "./replit/adapter"

export function resolveSurfaceAdapter(): SurfaceAdapter {
  const surface = getPromptSurface()
  if (surface === "CHATGPT") return chatGptSurfaceAdapter
  if (surface === "LOVABLE") return lovableSurfaceAdapter
  return replitSurfaceAdapter
}
