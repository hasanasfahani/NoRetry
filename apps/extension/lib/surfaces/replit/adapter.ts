import {
  createEmptyAssistantResponseSnapshot,
  createEmptyDraftPromptSnapshot,
  createEmptyUserPromptSnapshot,
  createPanelMountContext,
  createThreadSnapshot,
  type SurfaceAdapter
} from "../adapter"
import {
  collectVisibleOutputSnippet,
  findPromptInput,
  findSubmitButton,
  readPromptValue,
  writePromptValue
} from "../../replit"

function isVisibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function readRichText(node: HTMLElement | null) {
  if (!node) return ""

  const richContainers = node.querySelectorAll<HTMLElement>(
    ".markdown, [class*='markdown'], [data-message-author-role], p, li, pre, code"
  )

  if (richContainers.length) {
    const joined = Array.from(richContainers)
      .map((element) => element.innerText.trim())
      .filter(Boolean)
      .join("\n")
      .trim()

    if (joined) return joined
  }

  return node.innerText.trim()
}

function buildDomPath(node: HTMLElement | null) {
  if (!node) return ""

  const path: string[] = []
  let current: HTMLElement | null = node
  let depth = 0

  while (current && depth < 5) {
    const parent = current.parentElement
    const tag = current.tagName.toLowerCase()
    const index =
      parent == null
        ? 0
        : Array.from(parent.children)
            .filter((child) => child.tagName === current?.tagName)
            .indexOf(current)
    path.unshift(`${tag}:${Math.max(index, 0)}`)
    current = parent
    depth += 1
  }

  return path.join("/")
}

function readMessageIdentity(node: HTMLElement | null, fallbackText = "") {
  if (!node) return fallbackText.trim().slice(0, 120)

  const explicitId =
    node.getAttribute("data-message-id") ||
    node.getAttribute("data-id") ||
    node.id ||
    node.closest<HTMLElement>("[data-message-id]")?.getAttribute("data-message-id") ||
    node.closest<HTMLElement>("[data-id]")?.getAttribute("data-id") ||
    node.closest<HTMLElement>("[id]")?.id

  if (explicitId) return explicitId

  const testId = node.getAttribute("data-testid") || node.closest<HTMLElement>("[data-testid]")?.getAttribute("data-testid")
  const domPath = buildDomPath(node)
  const textSeed = fallbackText.trim().slice(0, 80)

  return [testId, domPath, textSeed].filter(Boolean).join("::")
}

function collectAssistantCandidates() {
  const selectors = [
    "[data-message-author-role='assistant']",
    "[data-message-role='assistant']",
    "[data-author='assistant']",
    "[data-role='assistant']",
    "[data-message-type='assistant']",
    "[data-testid*='assistant-message' i]",
    "[data-testid*='assistant' i]",
    "[data-testid*='response' i]",
    "[data-testid*='message' i]",
    "[data-testid*='chat' i]",
    "[class*='assistant' i]",
    "[class*='response' i]",
    "[class*='message' i]",
    "[class*='thread' i]",
    "[class*='conversation' i]",
    "[class*='markdown' i]",
    "main article",
    "main section",
    "main div",
    "main [role='article']",
    "main [role='listitem']",
    "main li",
    "[role='main'] article",
    "[role='main'] section",
    "[role='main'] div"
  ]

  const promptInput = findPromptInput()
  const promptValue = promptInput ? readPromptValue(promptInput).trim() : ""
  const candidates = new Map<HTMLElement, number>()

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    for (const element of elements) {
      if (!isVisibleElement(element)) continue
      if (element.closest("#prompt-optimizer-root")) continue
      if (promptInput && (element === promptInput || element.contains(promptInput))) continue

      const text = readRichText(element)
      if (!text || text.length < 16) continue
      if (promptValue && text.trim() === promptValue) continue

      const rect = element.getBoundingClientRect()
      const lowerText = text.toLowerCase()
      const hint = `${selector} ${(element.getAttribute("data-testid") || "").toLowerCase()} ${(element.className || "").toString().toLowerCase()}`

      let score = rect.bottom
      const childTextLength = Array.from(element.children).reduce(
        (sum, child) => sum + (((child as HTMLElement).innerText || "").trim().length || 0),
        0
      )

      if (hint.includes("assistant")) score += 400
      if (hint.includes("response")) score += 260
      if (hint.includes("message")) score += 120
      if (hint.includes("chat")) score += 80
      if (hint.includes("thread")) score += 80
      if (hint.includes("conversation")) score += 80
      if (hint.includes("markdown")) score += 60
      if (element.querySelector("pre, code")) score += 120
      if (element.querySelector(".markdown, [class*='markdown']")) score += 70
      if (text.length > 80) score += 50
      if (text.length > 180) score += 40
      if (childTextLength > text.length * 0.6) score += 30
      if (lowerText.includes("diff") || lowerText.includes("patch")) score += 30
      if (/\b(assistant|agent|analysis|updated|changed|here(?:'s| is)|let'?s)\b/i.test(text)) score += 40
      if (promptValue && lowerText.includes(promptValue.toLowerCase().slice(0, 40))) score -= 120
      if (rect.bottom > window.innerHeight * 0.3) score += 40
      if (rect.top < window.innerHeight * 0.2 && rect.bottom < window.innerHeight * 0.45) score -= 80
      if (text.length < 30 && !element.querySelector("pre, code")) score -= 80

      candidates.set(element, Math.max(candidates.get(element) ?? 0, score))
    }
  }

  const ranked = [...candidates.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([element]) => element)

  if (ranked.length) return ranked

  const fallbackRegions = [
    document.querySelector<HTMLElement>("main"),
    document.querySelector<HTMLElement>("[role='main']"),
    document.querySelector<HTMLElement>("article"),
    document.querySelector<HTMLElement>("section")
  ].filter(Boolean) as HTMLElement[]

  return fallbackRegions.filter((element) => {
    if (!isVisibleElement(element)) return false
    if (element.closest("#prompt-optimizer-root")) return false
    if (promptInput && (element === promptInput || element.contains(promptInput))) return false
    const text = readRichText(element)
    if (!text || text.length < 40) return false
    if (promptValue && text.trim() === promptValue) return false
    return true
  })
}

export const replitSurfaceAdapter: SurfaceAdapter = {
  id: "replit",
  label: "Replit",
  getDraftPrompt() {
    const input = findPromptInput()
    if (!input) return createEmptyDraftPromptSnapshot()

    return {
      exists: true,
      text: readPromptValue(input),
      input,
      submitButton: findSubmitButton(input)
    }
  },
  writeDraftPrompt(text: string) {
    const input = findPromptInput()
    if (!input) return false
    writePromptValue(input, text)
    return true
  },
  getLatestAssistantResponse() {
    const node = collectAssistantCandidates()[0] ?? null
    const text = readRichText(node) || collectVisibleOutputSnippet()
    if (!node || !text) return createEmptyAssistantResponseSnapshot()

    return {
      exists: true,
      text,
      identity: readMessageIdentity(node, text),
      node
    }
  },
  getLatestUserPrompt() {
    return createEmptyUserPromptSnapshot()
  },
  getThread() {
    return createThreadSnapshot(window.location.href)
  },
  getPanelMountContext() {
    return createPanelMountContext(findPromptInput())
  }
}
