function queryAllSafe<T extends Element>(root: ParentNode, selector: string) {
  try {
    return Array.from(root.querySelectorAll<T>(selector))
  } catch {
    return []
  }
}

function isVisibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.right > 0 &&
    rect.top < window.innerHeight &&
    rect.left < window.innerWidth &&
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    Number(style.opacity || "1") > 0
  )
}

function readText(node: HTMLElement | null) {
  if (!node) return ""

  const richNodes = node.querySelectorAll<HTMLElement>("p, li, pre, code, [class*='markdown'], [data-testid*='message']")
  if (richNodes.length > 0) {
    const joined = Array.from(richNodes)
      .map((element) => element.innerText.trim())
      .filter(Boolean)
      .join("\n")
      .trim()

    if (joined) return joined
  }

  return (node.innerText || node.textContent || "").trim()
}

function readIdentity(node: HTMLElement | null, fallbackText = "") {
  if (!node) return fallbackText.trim().slice(0, 120)

  return (
    node.getAttribute("data-message-id") ||
    node.getAttribute("data-id") ||
    node.id ||
    node.closest<HTMLElement>("[data-message-id]")?.getAttribute("data-message-id") ||
    node.closest<HTMLElement>("[data-id]")?.getAttribute("data-id") ||
    fallbackText.trim().slice(0, 120)
  )
}

function looksLikeComposerChrome(text: string) {
  return /\battach\b|\bprompt\b|\bsend\b|\bgenerate\b|\bpublish\b|\bshare\b|\bsettings\b/i.test(text)
}

function looksLikeWorkspaceChrome(text: string) {
  return /\bsettings\b|\btheme\b|\bshare\b|\bpublish\b|\bdeploy\b|\bdocs\b|\baccount\b|\bworkspace\b|\btemplate\b/i.test(text)
}

function isEditorLikeElement(element: HTMLElement) {
  return Boolean(
    element.closest(
      [
        ".cm-editor",
        ".monaco-editor",
        "[class*='editor']",
        "[data-testid*='editor']",
        "[data-testid*='file']",
        "[data-file-path]"
      ].join(",")
    )
  )
}

function collectCandidateMessages() {
  const selectors = [
    "[data-message-author-role='assistant']",
    "[data-message-author-role='user']",
    "[data-author='assistant']",
    "[data-author='user']",
    "[data-role='assistant']",
    "[data-role='user']",
    "[data-testid*='assistant']",
    "[data-testid*='user']",
    "[data-testid*='message']",
    "[class*='message']",
    "[class*='chat'] article",
    "[class*='chat'] section",
    "main article",
    "main section"
  ]

  const seen = new Set<HTMLElement>()
  const nodes: HTMLElement[] = []

  for (const selector of selectors) {
    for (const node of queryAllSafe<HTMLElement>(document, selector)) {
      if (seen.has(node)) continue
      if (node.closest("#prompt-optimizer-root")) continue
      if (!isVisibleElement(node)) continue
      if (isEditorLikeElement(node)) continue
      if (node.closest("header, nav, aside, footer, [role='navigation'], [role='search']")) continue

      const text = readText(node)
      if (text.length < 16) continue
      if (looksLikeComposerChrome(text) && text.length < 120) continue
      if (looksLikeWorkspaceChrome(text) && text.length < 160) continue

      seen.add(node)
      nodes.push(node)
    }
  }

  return nodes
}

function scoreAssistantCandidate(node: HTMLElement, promptInput: HTMLElement | null) {
  const text = readText(node)
  const rect = node.getBoundingClientRect()
  const promptRect = promptInput?.getBoundingClientRect() ?? null
  const hints = `${node.getAttribute("data-testid") ?? ""} ${node.getAttribute("data-author") ?? ""} ${node.getAttribute("data-role") ?? ""} ${node.className ?? ""}`.toLowerCase()

  let score = Math.min(text.length, 300)

  if (hints.includes("assistant")) score += 140
  if (hints.includes("response")) score += 90
  if (hints.includes("message")) score += 24
  if (rect.top < window.innerHeight * 0.8) score += 10

  if (promptRect) {
    if (rect.bottom < promptRect.top) score += 34
    if (Math.abs(rect.left - promptRect.left) < 220) score += 16
  }

  if (node.querySelector("pre, code")) score += 14
  if (node.querySelector("p, li")) score += 8
  if (looksLikeComposerChrome(text)) score -= 80
  if (promptInput && node.contains(promptInput)) score -= 120

  return score
}

function scoreUserCandidate(node: HTMLElement, promptInput: HTMLElement | null) {
  const text = readText(node)
  const rect = node.getBoundingClientRect()
  const promptRect = promptInput?.getBoundingClientRect() ?? null
  const hints = `${node.getAttribute("data-testid") ?? ""} ${node.getAttribute("data-author") ?? ""} ${node.getAttribute("data-role") ?? ""} ${node.className ?? ""}`.toLowerCase()

  let score = Math.min(text.length, 220)

  if (hints.includes("user")) score += 120
  if (hints.includes("message")) score += 18
  if (promptRect && rect.bottom < promptRect.top) score += 26
  if (promptRect && Math.abs(rect.left - promptRect.left) < 220) score += 12
  if (looksLikeComposerChrome(text)) score -= 80
  if (promptInput && node.contains(promptInput)) score -= 120

  return score
}

export function findLatestLovableAssistantMessage(promptInput: HTMLElement | null) {
  const candidates = collectCandidateMessages()
    .map((node) => ({ node, score: scoreAssistantCandidate(node, promptInput) }))
    .filter((entry) => entry.score >= 48)
    .sort((left, right) => {
      const leftRect = left.node.getBoundingClientRect()
      const rightRect = right.node.getBoundingClientRect()
      if (Math.abs(rightRect.bottom - leftRect.bottom) > 24) {
        return rightRect.bottom - leftRect.bottom
      }
      return right.score - left.score
    })

  return candidates[0]?.node ?? null
}

export function findLatestLovableUserMessage(promptInput: HTMLElement | null) {
  const candidates = collectCandidateMessages()
    .map((node) => ({ node, score: scoreUserCandidate(node, promptInput) }))
    .filter((entry) => entry.score >= 40)
    .sort((left, right) => {
      const leftRect = left.node.getBoundingClientRect()
      const rightRect = right.node.getBoundingClientRect()
      if (Math.abs(rightRect.bottom - leftRect.bottom) > 24) {
        return rightRect.bottom - leftRect.bottom
      }
      return right.score - left.score
    })

  return candidates[0]?.node ?? null
}

export function readLovableAssistantText(node: HTMLElement | null) {
  return readText(node)
}

export function readLovableUserText(node: HTMLElement | null) {
  return readText(node)
}

export function readLovableMessageIdentity(node: HTMLElement | null, fallbackText = "") {
  return readIdentity(node, fallbackText)
}

function readCandidateText(node: HTMLElement | null) {
  if (!node) return ""
  return (node.innerText || node.textContent || "").trim()
}

function collectVisibleWorkspaceTextCandidates() {
  const selectors = ["main", "[role='main']", "article", "section", "[data-testid*='preview']", "[data-testid*='result']"]
  const seen = new Set<HTMLElement>()
  const rows: string[] = []

  for (const selector of selectors) {
    for (const node of queryAllSafe<HTMLElement>(document, selector)) {
      if (seen.has(node)) continue
      if (node.closest("#prompt-optimizer-root")) continue
      if (!isVisibleElement(node)) continue
      if (node.closest("header, nav, aside, footer, [role='navigation'], [role='search']")) continue

      const text = readCandidateText(node)
      if (text.length < 40) continue
      if (looksLikeComposerChrome(text) && text.length < 180) continue
      if (looksLikeWorkspaceChrome(text) && text.length < 180) continue

      seen.add(node)
      rows.push(text)
    }
  }

  return rows
}

function removeDuplicateExcerpt(text: string, duplicateOf: string) {
  if (!duplicateOf) return text

  const normalizedText = text.replace(/\s+/g, " ").trim()
  const normalizedDuplicate = duplicateOf.replace(/\s+/g, " ").trim()
  if (!normalizedText || !normalizedDuplicate) return text
  if (normalizedText === normalizedDuplicate) return ""
  if (normalizedText.includes(normalizedDuplicate) && normalizedText.length - normalizedDuplicate.length < 80) return ""
  return text
}

export function collectLovableVisibleOutputSnippet(responseText = "") {
  const candidates = collectVisibleWorkspaceTextCandidates()
    .map((text) => removeDuplicateExcerpt(text, responseText))
    .filter(Boolean)

  return (candidates[0] ?? "").slice(0, 600)
}

export function readLovableProjectLabel() {
  const selectors = ["h1", "[data-testid*='project']", "[class*='project']", "title"]

  for (const selector of selectors) {
    const node =
      selector === "title"
        ? (document.querySelector("title") as HTMLElement | null)
        : queryAllSafe<HTMLElement>(document, selector).find(
            (element) => isVisibleElement(element) && !element.closest("#prompt-optimizer-root")
          ) ?? null
    const text = readCandidateText(node)
    if (!text) continue
    if (looksLikeWorkspaceChrome(text)) continue
    return text.slice(0, 120)
  }

  return document.title.trim().slice(0, 120)
}
