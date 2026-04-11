import { SUPPORTED_HOSTS } from "@prompt-optimizer/shared/src/constants"

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
  '[contenteditable="true"][role="textbox"]',
  '[contenteditable="true"]'
]

const SUBMIT_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="send message" i]',
  'button[aria-label*="send prompt" i]',
  'button[aria-label*="send" i]',
  'button[aria-label*="submit" i]',
  'button[type="submit"]'
]

export function isSupportedPromptPage(locationLike = window.location) {
  return SUPPORTED_HOSTS.includes(locationLike.hostname)
}

export function getPromptSurface(locationLike = window.location): "REPLIT" | "CHATGPT" {
  return locationLike.hostname.includes("openai.com") || locationLike.hostname.includes("chatgpt.com")
    ? "CHATGPT"
    : "REPLIT"
}

export function findPromptInput(): HTMLElement | null {
  const chatGptPrompt = document.getElementById("prompt-textarea")
  if (chatGptPrompt instanceof HTMLElement && isPromptLikeElement(chatGptPrompt)) {
    return chatGptPrompt
  }

  const activeElement = document.activeElement
  if (activeElement instanceof HTMLElement && isPromptLikeElement(activeElement)) {
    return activeElement
  }

  const candidates = new Map<HTMLElement, number>()

  for (const selector of PROMPT_INPUT_SELECTORS) {
    const matches = Array.from(document.querySelectorAll<HTMLElement>(selector))
    for (const element of matches) {
      if (!isPromptLikeElement(element)) continue
      candidates.set(element, scorePromptElement(element))
    }
  }

  const rankedCandidates = [...candidates.entries()].sort((left, right) => right[1] - left[1])
  if (getPromptSurface() !== "REPLIT") {
    return rankedCandidates[0]?.[0] ?? null
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

  const elementId = (element.id || "").toLowerCase()
  if (elementId === "prompt-textarea") return true

  const rect = element.getBoundingClientRect()
  if (rect.width <= 120 || rect.height <= 24) return false

  const tagName = element.tagName.toLowerCase()
  const role = element.getAttribute("role")?.toLowerCase() ?? ""
  const ariaLabel = element.getAttribute("aria-label")?.toLowerCase() ?? ""
  const placeholder = element.getAttribute("placeholder")?.toLowerCase() ?? ""
  const contentEditable = element.getAttribute("contenteditable")?.toLowerCase() ?? ""
  const textHint = `${ariaLabel} ${placeholder}`

  if (tagName === "textarea") return true
  if (tagName === "input") return element.getAttribute("type") !== "password"
  if (contentEditable === "true") {
    return (
      role === "textbox" ||
      textHint.includes("agent") ||
      textHint.includes("prompt") ||
      textHint.includes("message") ||
      textHint.includes("ask")
    )
  }
  if (role === "textbox") return true

  return (
    textHint.includes("agent") ||
    textHint.includes("prompt") ||
    textHint.includes("describe") ||
    textHint.includes("message") ||
    textHint.includes("ask")
  )
}

function scorePromptElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const textHint = `${element.getAttribute("aria-label") ?? ""} ${element.getAttribute("placeholder") ?? ""}`.toLowerCase()
  const value = readPromptValue(element).trim()
  const isReplit = getPromptSurface() === "REPLIT"

  let score = 0

  if (value.length > 0) score += 80
  if (document.activeElement === element) score += 40
  if (findSubmitButton(element)) score += 28
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
  const directChatGptButton = document.querySelector<HTMLButtonElement>('button[data-testid="send-button"]')
  if (directChatGptButton && !directChatGptButton.closest("#prompt-optimizer-root")) {
    return directChatGptButton
  }

  const container = input.closest("form, section, div")
  if (!container) return null

  for (const selector of SUBMIT_BUTTON_SELECTORS) {
    const match = container.querySelector<HTMLButtonElement>(selector)
    if (match && !match.closest("#prompt-optimizer-root")) return match
  }

  return null
}

export function readPromptValue(input: HTMLElement) {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) return input.value
  return input.innerText || input.textContent || ""
}

function setContentEditableValue(input: HTMLElement, nextValue: string) {
  input.innerHTML = ""

  const lines = nextValue.replace(/\r\n/g, "\n").split("\n")
  lines.forEach((line, index) => {
    if (index > 0) {
      input.appendChild(document.createElement("br"))
    }

    if (line.length === 0) {
      input.appendChild(document.createElement("br"))
      return
    }

    input.appendChild(document.createTextNode(line))
  })
}

export function writePromptValue(input: HTMLElement, nextValue: string) {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const prototype =
      input instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value")
    descriptor?.set?.call(input, nextValue)
  } else {
    setContentEditableValue(input, nextValue)
  }

  const inputEvent =
    typeof InputEvent !== "undefined"
      ? new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" })
      : new Event("input", { bubbles: true })
  input.dispatchEvent(inputEvent)
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

  return match?.slice(0, 300) ?? null
}

export function collectChangedFilesSummary() {
  const fileNodes = Array.from(document.querySelectorAll<HTMLElement>("[data-file-path], [aria-label], [title]"))
  const files = fileNodes
    .map((node) => node.getAttribute("data-file-path") || node.getAttribute("aria-label") || node.getAttribute("title") || "")
    .filter((text) => /\.[a-z0-9]+$/i.test(text))

  return [...new Set(files)].slice(0, 20)
}
