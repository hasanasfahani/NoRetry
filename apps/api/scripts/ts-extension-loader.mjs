import { access } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

async function resolveTsCandidate(parentURL, specifier) {
  if (!parentURL.startsWith("file:")) return null

  const parentPath = fileURLToPath(parentURL)
  const baseDir = path.dirname(parentPath)
  const candidates = [
    path.resolve(baseDir, `${specifier}.ts`),
    path.resolve(baseDir, specifier, "index.ts")
  ]

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return pathToFileURL(candidate).href
    } catch {
      // keep trying candidates
    }
  }

  return null
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ERR_MODULE_NOT_FOUND" ||
      !context.parentURL ||
      specifier.endsWith(".ts") ||
      specifier.endsWith(".js") ||
      specifier.endsWith(".mjs") ||
      specifier.endsWith(".json")
    ) {
      throw error
    }

    if (
      !specifier.startsWith(".") &&
      !specifier.startsWith("/") &&
      !specifier.startsWith("file:")
    ) {
      throw error
    }

    const resolvedUrl = await resolveTsCandidate(context.parentURL, specifier)
    if (!resolvedUrl) throw error

    return {
      url: resolvedUrl,
      shortCircuit: true
    }
  }
}
