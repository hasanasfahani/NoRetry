import { SUPPORTED_HOSTS } from "@prompt-optimizer/shared/src/constants"

const LOVABLE_SUPPORT_ENABLED = process.env.PLASMO_PUBLIC_ENABLE_LOVABLE !== "false"

const PROMPT_INPUT_SELECTORS = [
  "#prompt-textarea",
  'textarea[data-testid="prompt-textarea"]',
  "textarea",
  "input[type='text']",
  "input:not([type])",
  '[aria-label*="message" i]',
  '[placeholder*="message" i]',
  '[placeholder*="ask" i]',
  'textarea[placeholder*="Agent"]',
  'textarea[placeholder*="Describe"]',
  'textarea[aria-label*="prompt" i]',
  '[role="textbox"]',
  '[aria-label*="agent" i]',
  '[aria-label*="prompt" i]',
  '[placeholder*="agent" i]',
  '[placeholder*="prompt" i]',
  '[data-testid*="prompt" i]',
  '[data-testid*="composer" i]',
  '[data-testid*="chat" i]',
  '[data-slate-editor="true"]',
  '.ProseMirror[contenteditable="true"]',
  '[class*="ProseMirror"][contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  '[contenteditable="true"]'
]

const LOVABLE_PROMPT_INPUT_SELECTORS = [
  '[data-testid*="prompt" i]',
  '[data-testid*="composer" i]',
  '[data-testid*="chat-input" i]',
  'textarea[placeholder*="build" i]',
  'textarea[placeholder*="describe" i]',
  'textarea[placeholder*="ask" i]',
  '[aria-label*="build" i]',
  '[aria-label*="describe" i]',
  '[aria-label*="message" i]',
  '[placeholder*="message" i]',
  '[role="textbox"]',
  '.ProseMirror[contenteditable="true"]',
  '[class*="ProseMirror"][contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  '[contenteditable="true"]',
  'textarea',
  'input[type="text"]',
  'input:not([type])'
]

const SUBMIT_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Start" i]',
  'button[aria-label*="start" i]',
  'button[aria-label*="send message" i]',
  'button[aria-label*="send prompt" i]',
  'button[aria-label*="send" i]',
  'button[aria-label*="submit" i]',
  'button[data-testid*="send" i]',
  'button[data-testid*="submit" i]',
  'button[type="submit"]',
  'form button',
  'button:has(svg)'
]

const LOVABLE_SUBMIT_BUTTON_SELECTORS = [
  'button[aria-label*="send" i]',
  'button[aria-label*="submit" i]',
  'button[aria-label*="generate" i]',
  'button[aria-label*="create" i]',
  'button[data-testid*="send" i]',
  'button[data-testid*="submit" i]',
  'button[data-testid*="prompt" i]',
  'button[type="submit"]',
  'form button',
  'button:has(svg)'
]

const REPLIT_CONNECTION_INTERRUPT_PATTERNS = [
  /your connection to replit has been temporarily interrupted/i,
  /please refresh/i,
  /connection lost/i,
  /reload to connect/i,
  /back to home/i
]

const LOVABLE_UNSUPPORTED_PATH_PATTERNS = [
  /^\/(?:blog|careers|changelog|contact|docs|guides|help|jobs|legal|login|pricing|privacy|sign-in|sign-up|signup|signin|support|terms)(?:\/|$)/i
]

const REPLIT_FILE_PREVIEW_HINTS = [
  "filepreview",
  "textpreview",
  "expandablefeedcontent",
  "eventrenderer",
  "eventcontainer",
  "output file",
  "1 output file"
]

function queryAllSafe<T extends Element>(root: ParentNode, selector: string) {
  try {
    return Array.from(root.querySelectorAll<T>(selector))
  } catch {
    return []
  }
}

function readEditableElementValue(element: HTMLElement) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value
  return element.innerText || element.textContent || ""
}

function normalizePromptComparisonValue(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim()
}

export function promptValueMatches(input: HTMLElement, expectedValue: string) {
  const actual = normalizePromptComparisonValue(readPromptValue(input))
  const expected = normalizePromptComparisonValue(expectedValue)
  if (!expected) return !actual
  if (actual === expected) return true

  const prefix = expected.slice(0, Math.min(160, expected.length))
  const suffix = expected.slice(Math.max(0, expected.length - 160))
  const lengthCloseEnough = actual.length >= Math.floor(expected.length * 0.92)
  return lengthCloseEnough && actual.startsWith(prefix) && actual.endsWith(suffix)
}

function getPromptInputSelectors() {
  return getPromptSurface() === "LOVABLE" ? LOVABLE_PROMPT_INPUT_SELECTORS : PROMPT_INPUT_SELECTORS
}

function getSubmitButtonSelectors() {
  return getPromptSurface() === "LOVABLE" ? LOVABLE_SUBMIT_BUTTON_SELECTORS : SUBMIT_BUTTON_SELECTORS
}

function hasVisibleTextPattern(patterns: RegExp[], selectors: string[]) {
  for (const selector of selectors) {
    const elements = queryAllSafe<HTMLElement>(document, selector)
    for (const element of elements) {
      if (!isVisibleElement(element)) continue
      if (element.closest("#prompt-optimizer-root")) continue
      const text = element.innerText.trim()
      if (!text) continue
      if (patterns.some((pattern) => pattern.test(text))) {
        return true
      }
    }
  }

  return false
}

export function isSupportedPromptPage(locationLike = window.location) {
  if (!SUPPORTED_HOSTS.includes(locationLike.hostname)) return false
  if (locationLike.hostname.includes("lovable.dev")) {
    return LOVABLE_SUPPORT_ENABLED && !LOVABLE_UNSUPPORTED_PATH_PATTERNS.some((pattern) => pattern.test(locationLike.pathname))
  }
  return true
}

export function isLovableSupportEnabled() {
  return LOVABLE_SUPPORT_ENABLED
}

export function getPromptSurface(locationLike = window.location): "REPLIT" | "CHATGPT" | "LOVABLE" {
  if (locationLike.hostname.includes("openai.com") || locationLike.hostname.includes("chatgpt.com")) {
    return "CHATGPT"
  }
  if (locationLike.hostname.includes("lovable.dev")) {
    return "LOVABLE"
  }
  return "REPLIT"
}

export function isReplitConnectionInterrupted() {
  if (getPromptSurface() !== "REPLIT") return false

  return hasVisibleTextPattern(REPLIT_CONNECTION_INTERRUPT_PATTERNS, [
    "[role='dialog']",
    "[role='alert']",
    "[role='status']",
    "[data-testid*='modal' i]",
    "[data-testid*='dialog' i]",
    "main",
    "section",
    "article"
  ])
}

export function findPromptInput(): HTMLElement | null {
  const chatGptPrompt = document.getElementById("prompt-textarea")
  if (chatGptPrompt instanceof HTMLElement && isPromptLikeElement(chatGptPrompt)) {
    return chatGptPrompt
  }

  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && isEditablePromptElement(activeElement) && isPromptLikeElement(activeElement)) {
    return activeElement
  }

  const candidates = new Map<HTMLElement, number>()

  for (const selector of getPromptInputSelectors()) {
    const matches = queryAllSafe<HTMLElement>(document, selector)
    for (const element of matches) {
      if (!isPromptLikeElement(element)) continue
      candidates.set(element, scorePromptElement(element))
    }
  }

  const rankedCandidates = [...candidates.entries()].sort((left, right) => right[1] - left[1])
  if (getPromptSurface() !== "REPLIT") {
    return rankedCandidates[0]?.[0] ?? null
  }

  const submitButton = findVisiblePromptSubmitButton()
  const submitAnchoredInput = submitButton ? findPromptInputNearSubmitButton(submitButton) : null
  if (submitAnchoredInput) {
    return submitAnchoredInput
  }

  const lowerViewportCandidates = rankedCandidates.filter(([element]) => {
    const rect = element.getBoundingClientRect()
    return rect.bottom > window.innerHeight * 0.55
  })

  if (lowerViewportCandidates.length > 0) {
    return lowerViewportCandidates.sort((left, right) => {
      const leftRect = left[0].getBoundingClientRect()
      const rightRect = right[0].getBoundingClientRect()

      if (Math.abs(rightRect.bottom - leftRect.bottom) > 24) {
        return rightRect.bottom - leftRect.bottom
      }

      return right[1] - left[1]
    })[0][0]
  }

  return rankedCandidates[0]?.[0] ?? null
}

export function isPromptLikeElement(element: HTMLElement) {
  if (element.closest("#prompt-optimizer-root")) return false
  if (isReplitFilePreviewElement(element)) return false

  const elementId = (element.id || "").toLowerCase()
  if (elementId === "prompt-textarea") return true

  const rect = element.getBoundingClientRect()
  if (rect.width <= 120 || rect.height <= 24) return false

  const tagName = element.tagName.toLowerCase()
  const role = element.getAttribute("role")?.toLowerCase() ?? ""
  const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() ?? ""
  const placeholder = element.getAttribute("placeholder")?.toLowerCase() ?? ""
  const dataTestId = element.getAttribute("data-testid")?.toLowerCase() ?? ""
  const dataSlateEditor = element.getAttribute("data-slate-editor")?.toLowerCase() ?? ""
  const className = typeof element.className === "string" ? element.className.toLowerCase() : ""
  const contentEditable = element.getAttribute("contenteditable")?.toLowerCase() ?? ""
  const editable = isEditablePromptElement(element)
  const ancestorHint = getPromptAncestorHint(element)
  const textHint = `${ariaLabel} ${placeholder} ${dataTestId} ${dataSlateEditor} ${className} ${ancestorHint}`

  if (tagName === "textarea") return true
  if (tagName === "input") return element.getAttribute("type") !== "password"
  const hasPromptHint =
    textHint.includes("agent") ||
    textHint.includes("prompt") ||
    textHint.includes("composer") ||
    textHint.includes("lovable") ||
    textHint.includes("build") ||
    textHint.includes("create") ||
    textHint.includes("chat") ||
    textHint.includes("message") ||
    textHint.includes("ask")

  if (contentEditable === "true" || contentEditable === "plaintext-only") {
    return (
      role === "textbox" ||
      className.includes("prosemirror") ||
      dataSlateEditor === "true" ||
      hasPromptHint ||
      (getPromptSurface() === "REPLIT" && rect.bottom > window.innerHeight * 0.58 && rect.width > 260)
    )
  }
  if (role === "textbox") {
    if (!editable) return false
    return hasPromptHint || (getPromptSurface() === "REPLIT" && rect.bottom > window.innerHeight * 0.66 && rect.width > 260)
  }

  if (!editable) return false
  return hasPromptHint || textHint.includes("describe")
}

export function findPromptLikeAncestor(target: EventTarget | HTMLElement | null) {
  let current: HTMLElement | null = null

  if (target instanceof HTMLElement) {
    current = target
  } else if (target instanceof Node) {
    current = target.parentElement
  }

  while (current && current !== document.body) {
    if (isEditablePromptElement(current) && isPromptLikeElement(current)) {
      return current
    }
    current = current.parentElement
  }

  return null
}

function getPromptAncestorHint(element: HTMLElement) {
  const hints: string[] = []
  let current: HTMLElement | null = element
  for (let depth = 0; current && depth < 5; depth += 1) {
    hints.push(
      current.getAttribute("aria-label") ?? "",
      current.getAttribute("placeholder") ?? "",
      current.getAttribute("data-testid") ?? "",
      typeof current.className === "string" ? current.className : ""
    )
    current = current.parentElement
  }
  return hints.join(" ").toLowerCase()
}

function isReplitFilePreviewElement(element: HTMLElement) {
  if (getPromptSurface() !== "REPLIT") return false

  const previewContainer = element.closest<HTMLElement>(
    [
      '[class*="FilePreview" i]',
      '[class*="textPreview" i]',
      '[class*="ExpandableFeedContent" i]',
      '[class*="EventRenderer" i]',
      '[class*="EventContainer" i]'
    ].join(", ")
  )
  if (previewContainer) return true

  const ancestorHint = getPromptAncestorHint(element)
  if (REPLIT_FILE_PREVIEW_HINTS.some((hint) => ancestorHint.includes(hint))) {
    return true
  }

  const text = readEditableElementValue(element).trim().toLowerCase()
  if (!text) return false

  return (
    text.startsWith("# project overview") ||
    text.includes("output file") ||
    text.includes("text preview") ||
    text.includes(".md\ntext")
  )
}

function isEditablePromptElement(element: HTMLElement) {
  if (isReplitFilePreviewElement(element)) return false

  const tagName = element.tagName.toLowerCase()
  if (tagName === "textarea") return true
  if (tagName === "input") return element.getAttribute("type") !== "password"

  const contentEditable = element.getAttribute("contenteditable")?.toLowerCase() ?? ""
  if (contentEditable === "true" || contentEditable === "plaintext-only") return true

  const role = element.getAttribute("role")?.toLowerCase() ?? ""
  if (role !== "textbox") return false

  return contentEditable === "true" || contentEditable === "plaintext-only" || element.isContentEditable
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

function getElementCenter(rect: DOMRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  }
}

function scoreSubmitButton(button: HTMLButtonElement) {
  const rect = button.getBoundingClientRect()
  const center = getElementCenter(rect)
  const hint = `${button.getAttribute("aria-label") ?? ""} ${button.getAttribute("data-testid") ?? ""} ${button.getAttribute("title") ?? ""} ${button.textContent ?? ""}`.toLowerCase()
  const compactIconButton = rect.width >= 24 && rect.width <= 96 && rect.height >= 24 && rect.height <= 96
  const promptAncestorHint = getPromptAncestorHint(button)

  let score = 0
  if (/\bstart\b/.test(hint)) score += 68
  if (hint.includes("send")) score += 60
  if (hint.includes("submit")) score += 44
  if (hint.includes("run")) score += 20
  if (hint.includes("arrow")) score += 14
  if (promptAncestorHint.includes("agent")) score += 22
  if (promptAncestorHint.includes("prompt")) score += 22
  if (promptAncestorHint.includes("composer")) score += 22
  if (promptAncestorHint.includes("chat")) score += 14
  if (button.type === "submit") score += 22
  if (button.querySelector("svg")) score += 12
  if (compactIconButton) score += 16
  if (rect.bottom > window.innerHeight * 0.55) score += 30
  if (center.x > window.innerWidth * 0.45) score += 14
  if (button.disabled) score -= 8
  if (button.closest("header, nav, aside, [role='search']")) score -= 80
  if (/\b(add attachment|attachment|voice|search|menu|sidebar|copy link|app actions|deep review)\b/.test(hint)) score -= 120
  if (rect.top < window.innerHeight * 0.2) score -= 22
  if (score >= 20 && findPromptInputNearSubmitButton(button)) score += 34

  return score
}

function rankSubmitButtons(buttons: HTMLButtonElement[]) {
  return buttons
    .filter((button, index, items) => items.indexOf(button) === index)
    .filter((button) => !button.closest("#prompt-optimizer-root"))
    .filter(isVisibleElement)
    .map((button) => ({ button, score: scoreSubmitButton(button) }))
    .filter(({ score }) => score >= 38)
    .sort((left, right) => right.score - left.score)
}

function scorePromptElement(element: HTMLElement) {
  if (isReplitFilePreviewElement(element)) return Number.NEGATIVE_INFINITY

  const rect = element.getBoundingClientRect()
  const textHint = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("placeholder") ?? ""}`.toLowerCase()
  const value = readPromptValue(element).trim()
  const isReplit = getPromptSurface() === "REPLIT"

  let score = 0

  if (value.length > 0) score += 80
  if (document.activeElement === element) score += 40
  const submitButton = findSubmitButton(element)
  if (submitButton) score += 28
  if (textHint.includes("agent")) score += 18
  if (textHint.includes("prompt")) score += 16
  if (textHint.includes("message")) score += 18
  if (textHint.includes("ask")) score += 14
  if (textHint.includes("describe")) score += 12
  if ((element.id || "").toLowerCase() === "prompt-textarea") score += 40
  if (rect.bottom > window.innerHeight * 0.55) score += 14
  if (rect.width > 260) score += 8
  if (isReplit && rect.bottom > window.innerHeight * 0.72) score += 26
  if (isReplit && rect.top < window.innerHeight * 0.25) score -= 55
  if (isReplit && !submitButton && rect.bottom < window.innerHeight * 0.72) score -= 24

  const regionHint = [
    element.closest("header"),
    element.closest("nav"),
    element.closest("aside"),
    element.closest('[role="search"]')
  ].some(Boolean)

  if (regionHint) score -= 35

  return score
}

export function findSubmitButton(input: HTMLElement): HTMLButtonElement | null {
  if (isReplitFilePreviewElement(input)) return null

  const directChatGptButton = queryAllSafe<HTMLButtonElement>(document, 'button[data-testid="send-button"]')[0] ?? null
  if (directChatGptButton && !directChatGptButton.closest("#prompt-optimizer-root") && isVisibleElement(directChatGptButton)) {
    return directChatGptButton
  }

  const container = input.closest("form, section, div")
  if (!container) return null

  if (getPromptSurface() === "REPLIT") {
    const buttons = [
      ...getSubmitButtonSelectors().flatMap((selector) => queryAllSafe<HTMLButtonElement>(container, selector)),
      ...queryAllSafe<HTMLButtonElement>(container, "button")
    ]
    return rankSubmitButtons(buttons)[0]?.button ?? null
  }

  for (const selector of getSubmitButtonSelectors()) {
    const match = queryAllSafe<HTMLButtonElement>(container, selector)[0] ?? null
    if (match && !match.closest("#prompt-optimizer-root") && isVisibleElement(match)) return match
  }

  return null
}

export function findPromptInputNearSubmitButton(button: HTMLButtonElement): HTMLElement | null {
  if (button.closest("#prompt-optimizer-root")) return null

  const containers: HTMLElement[] = []
  const directContainers = [
    button.closest<HTMLElement>("form"),
    button.closest<HTMLElement>("[role='form']"),
    button.closest<HTMLElement>("[data-testid*='composer' i]"),
    button.closest<HTMLElement>("[data-testid*='prompt' i]")
  ]

  directContainers.forEach((container) => {
    if (container && !containers.includes(container)) containers.push(container)
  })

  let current = button.parentElement
  for (let depth = 0; current && depth < 7; depth += 1) {
    if (!containers.includes(current)) containers.push(current)
    current = current.parentElement
  }

  const buttonRect = button.getBoundingClientRect()
  const buttonCenter = getElementCenter(buttonRect)
  const candidates = new Map<HTMLElement, number>()

  for (const container of containers) {
    for (const selector of getPromptInputSelectors()) {
      const matches = queryAllSafe<HTMLElement>(container, selector)
      for (const element of matches) {
        if (element === button || element.closest("#prompt-optimizer-root") || !isVisibleElement(element)) continue
        if (isReplitFilePreviewElement(element)) continue

        const strictPromptMatch = isPromptLikeElement(element)
        const tagName = element.tagName.toLowerCase()
        const contentEditable = element.getAttribute("contenteditable")?.toLowerCase() ?? ""
        const isEditable =
          tagName === "textarea" ||
          (tagName === "input" && element.getAttribute("type") !== "password") ||
          contentEditable === "true" ||
          contentEditable === "plaintext-only" ||
          element.getAttribute("role")?.toLowerCase() === "textbox"

        if (!strictPromptMatch && !isEditable) continue

        const rect = element.getBoundingClientRect()
        const elementCenter = getElementCenter(rect)
        const verticalDistance = Math.abs(elementCenter.y - buttonCenter.y)
        const horizontalDistance = Math.abs(elementCenter.x - buttonCenter.x)
        const promptValue = readPromptValue(element).trim()

        let score = strictPromptMatch ? 50 : 10
        if (promptValue) score += 60
        if (document.activeElement === element) score += 32
        if (rect.width > 220) score += 18
        if (rect.bottom > window.innerHeight * 0.5) score += 22
        if (verticalDistance < 160) score += 26
        if (horizontalDistance < window.innerWidth * 0.7) score += 8
        if (element.closest("header, nav, aside, [role='search']")) score -= 90

        candidates.set(element, Math.max(candidates.get(element) ?? Number.NEGATIVE_INFINITY, score))
      }
    }
  }

  return [...candidates.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null
}

export function findVisiblePromptSubmitButton(): HTMLButtonElement | null {
  const buttons = [
    ...getSubmitButtonSelectors().flatMap((selector) => queryAllSafe<HTMLButtonElement>(document, selector)),
    ...queryAllSafe<HTMLButtonElement>(document, "button")
  ]

  const candidates = rankSubmitButtons(buttons)
  return candidates[0]?.button ?? null
}

export function readPromptValue(input: HTMLElement) {
  if (isReplitFilePreviewElement(input)) return ""
  return readEditableElementValue(input)
}

function setContentEditableValue(input: HTMLElement, nextValue: string) {
  input.focus()

  const selection = window.getSelection()
  if (selection && typeof document.execCommand === "function") {
    const range = document.createRange()
    range.selectNodeContents(input)
    selection.removeAllRanges()
    selection.addRange(range)

    if (document.execCommand("insertText", false, nextValue)) {
      return
    }
  }

  input.innerHTML = ""

  const lines = nextValue.replace(/\r\n/g, "\n").split("\n")
  lines.forEach((line, index) => {
    if (index > 0) {
      input.appendChild(document.createTextNode("\n"))
    }

    if (line.length === 0) {
      input.appendChild(document.createTextNode("\n"))
      return
    }

    input.appendChild(document.createTextNode(line))
  })
}

function dispatchPromptInputEvents(input: HTMLElement, nextValue: string) {
  const beforeInputEvent =
    typeof InputEvent !== "undefined"
      ? new InputEvent("beforeinput", { bubbles: true, cancelable: true, data: nextValue, inputType: "insertText" })
      : new Event("beforeinput", { bubbles: true, cancelable: true })
  input.dispatchEvent(beforeInputEvent)

  const inputEvent =
    typeof InputEvent !== "undefined"
      ? new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" })
      : new Event("input", { bubbles: true })
  input.dispatchEvent(inputEvent)

  input.dispatchEvent(new Event("change", { bubbles: true }))
}

function writePromptValueWithDomMutation(input: HTMLElement, nextValue: string) {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const prototype =
      input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
    descriptor?.set?.call(input, nextValue)
  } else {
    setContentEditableValue(input, nextValue)
  }
}

export function writePromptValue(input: HTMLElement, nextValue: string) {
  writePromptValueWithDomMutation(input, nextValue)
  dispatchPromptInputEvents(input, nextValue)

  if (promptValueMatches(input, nextValue)) return true

  input.focus()
  if (!(input instanceof HTMLTextAreaElement) && !(input instanceof HTMLInputElement)) {
    input.textContent = nextValue
    dispatchPromptInputEvents(input, nextValue)
  }

  return promptValueMatches(input, nextValue)
}

export function collectVisibleOutputSnippet() {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("main, [role='main'], article, section"))
    .map((element) => element.innerText.trim())
    .filter(Boolean)
    .filter((text) => text.length > 40)

  return (candidates[0] ?? "").slice(0, 500)
}

export function collectVisibleErrorSummary() {
  const errorNodes = Array.from(document.querySelectorAll<HTMLElement>("pre, code, [role='alert'], .error"))
  const match = errorNodes
    .map((node) => node.innerText.trim())
    .find((text) => /\berror\b|\bfailed\b|\bexception\b/i.test(text))

  return match?.slice(0, 300) ?? ""
}

export function collectChangedFilesSummary() {
  const limitFileLabel = (value: string) => {
    const trimmed = value.trim()
    if (trimmed.length <= 180) return trimmed
    return `${trimmed.slice(0, 179).trimEnd()}…`
  }

  const fileNodes = Array.from(document.querySelectorAll<HTMLElement>("[data-file-path], [aria-label], [title]"))
  const files = fileNodes
    .map((node) => node.getAttribute("data-file-path") || node.getAttribute("aria-label") || node.getAttribute("title") || "")
    .map((text) => limitFileLabel(text))
    .filter((text) => /\.[a-z0-9]+$/i.test(text))

  return [...new Set(files)].slice(0, 20)
}
