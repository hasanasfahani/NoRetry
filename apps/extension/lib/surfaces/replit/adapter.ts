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

function isEditorLikeElement(element: HTMLElement) {
  return Boolean(
    element.closest(
      [
        ".cm-editor",
        ".monaco-editor",
        ".view-lines",
        "[data-testid*='editor']",
        "[class*='CodeMirror']",
        "[class*='monaco']",
        "[class*='editor']",
        "[data-file-path]",
        "[data-testid*='file']",
        "[class*='file-tree']",
        "[class*='workspace']"
      ].join(",")
    )
  )
}

function findConversationContainer(promptInput: HTMLElement | null) {
  if (!promptInput) return null

  return (
    promptInput.closest<HTMLElement>(
      [
        "[data-testid*='chat' i]",
        "[data-testid*='thread' i]",
        "[data-testid*='conversation' i]",
        "[class*='chat' i]",
        "[class*='thread' i]",
        "[class*='conversation' i]",
        "[class*='agent' i]",
        "section",
        "article",
        "main"
      ].join(",")
    ) ?? null
  )
}

function horizontalOverlapRatio(a: DOMRect, b: DOMRect) {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  const width = Math.min(a.width, b.width)
  if (width <= 0) return 0
  return overlap / width
}

function compareAssistantCandidates(
  left: HTMLElement,
  right: HTMLElement,
  promptRect: DOMRect | null,
  conversationContainer: HTMLElement | null,
  candidateScores: Map<HTMLElement, number>
) {
  const leftRect = left.getBoundingClientRect()
  const rightRect = right.getBoundingClientRect()
  const leftInConversation = Boolean(conversationContainer) && conversationContainer.contains(left)
  const rightInConversation = Boolean(conversationContainer) && conversationContainer.contains(right)

  if (leftInConversation !== rightInConversation) {
    return rightInConversation ? 1 : -1
  }

  const leftAligned = promptRect != null && horizontalOverlapRatio(leftRect, promptRect) > 0.45
  const rightAligned = promptRect != null && horizontalOverlapRatio(rightRect, promptRect) > 0.45
  if (leftAligned !== rightAligned) {
    return rightAligned ? 1 : -1
  }

  if (Math.abs(rightRect.bottom - leftRect.bottom) > 32) {
    return rightRect.bottom - leftRect.bottom
  }

  return (candidateScores.get(right) ?? 0) - (candidateScores.get(left) ?? 0)
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
  const promptRect = promptInput?.getBoundingClientRect() ?? null
  const conversationContainer = findConversationContainer(promptInput)
  const candidates = new Map<HTMLElement, number>()

  for (const selector of selectors) {
    const elements = Array.from(document.querySelectorAll<HTMLElement>(selector))
    for (const element of elements) {
      if (!isVisibleElement(element)) continue
      if (element.closest("#prompt-optimizer-root")) continue
      if (promptInput && (element === promptInput || element.contains(promptInput))) continue
      if (isEditorLikeElement(element)) continue

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
      const horizontallyAlignedWithPrompt =
        promptRect != null &&
        horizontalOverlapRatio(rect, promptRect) > 0.45
      const belowPrompt = promptRect != null && rect.top >= promptRect.top - 12
      const inConversationContainer =
        Boolean(conversationContainer) &&
        (conversationContainer === element || conversationContainer.contains(element) || element.contains(conversationContainer))
      const oversizedRegion =
        promptRect != null &&
        (rect.width > Math.max(promptRect.width * 1.9, window.innerWidth * 0.68) ||
          rect.height > window.innerHeight * 0.72)

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
      if (inConversationContainer) score += 180
      if (horizontallyAlignedWithPrompt) score += 120
      if (belowPrompt) score -= 120
      if (!horizontallyAlignedWithPrompt && promptRect) score -= 140
      if (oversizedRegion) score -= 220
      if (rect.left < window.innerWidth * 0.18) score -= 90
      if (rect.left < window.innerWidth * 0.28 && rect.width < window.innerWidth * 0.45) score -= 70

      candidates.set(element, Math.max(candidates.get(element) ?? 0, score))
    }
  }

  const ranked = [...candidates.keys()].sort((left, right) =>
    compareAssistantCandidates(left, right, promptRect, conversationContainer, candidates)
  )

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
    const url = new URL(window.location.href)
    const segments = url.pathname.split("/").filter(Boolean)
    const stablePath = segments.slice(0, 3).join("/")
    const identity = `${url.origin}/${stablePath || ""}`
    return createThreadSnapshot(window.location.href, identity)
  },
  getPanelMountContext() {
    return createPanelMountContext(findPromptInput())
  }
}
