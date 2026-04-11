import { resolveSurfaceAdapter } from "../surfaces/resolve-surface-adapter"

export function readAssistantMessageIdentity(node: HTMLElement | null, fallbackText = "") {
  const adapter = resolveSurfaceAdapter()
  const snapshot = adapter.getLatestAssistantResponse()
  if (node && snapshot.node === node) {
    return snapshot.identity
  }
  return node ? fallbackText.trim().slice(0, 120) : snapshot.identity || fallbackText.trim().slice(0, 120)
}

export function findLatestAssistantMessage() {
  return resolveSurfaceAdapter().getLatestAssistantResponse().node
}

export function readAssistantText(node: HTMLElement | null) {
  const adapter = resolveSurfaceAdapter()
  const snapshot = adapter.getLatestAssistantResponse()
  if (!node || snapshot.node === node) return snapshot.text
  return node.innerText.trim()
}

export function findLatestUserMessage() {
  return resolveSurfaceAdapter().getLatestUserPrompt().node
}

export function readUserText(node: HTMLElement | null) {
  const adapter = resolveSurfaceAdapter()
  const snapshot = adapter.getLatestUserPrompt()
  if (!node || snapshot.node === node) return snapshot.text
  return node.innerText.trim()
}
