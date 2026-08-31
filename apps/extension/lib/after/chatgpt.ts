function isVisibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function readRichText(node: HTMLElement | null) {
  if (!node) return ""

  const roleScoped =
    node.matches("[data-message-author-role]")
      ? node
      : node.querySelector<HTMLElement>('[data-message-author-role="assistant"], [data-message-author-role="user"]')
  const scopedNode = roleScoped ?? node
  const markdownNode = scopedNode.querySelector<HTMLElement>(".markdown, [class*='markdown']")
  const readableNode = markdownNode ?? scopedNode

  return readableNode.innerText.trim() || readableNode.textContent?.trim() || ""
}

function expandToConversationTurn(node: HTMLElement) {
  return node.closest<HTMLElement>('article[data-testid^="conversation-turn-"]') ?? node
}

export function findLatestChatGptAssistantMessage() {
  const exactMatches = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'))
    .filter((node) => !node.closest("#prompt-optimizer-root"))
    .filter(isVisibleElement)
  if (exactMatches.length) {
    const latest = exactMatches.at(-1)
    return latest ? expandToConversationTurn(latest) : null
  }

  const articleMatches = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid^="conversation-turn-"]'))
    .filter((node) => !node.closest("#prompt-optimizer-root"))
    .filter(isVisibleElement)
    .filter((node) => {
      const text = readRichText(node)
      if (!text) return false
      const lower = text.toLowerCase()
      return !lower.startsWith("you said:") && !lower.startsWith("you:")
    })

  return articleMatches.at(-1) ?? null
}

export function findLatestChatGptUserMessage() {
  const exactMatches = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]'))
    .filter((node) => !node.closest("#prompt-optimizer-root"))
    .filter(isVisibleElement)
  if (exactMatches.length) {
    const latest = exactMatches.at(-1)
    return latest ? expandToConversationTurn(latest) : null
  }

  const articleMatches = Array.from(document.querySelectorAll<HTMLElement>('article[data-testid^="conversation-turn-"]'))
    .filter((node) => !node.closest("#prompt-optimizer-root"))
    .filter(isVisibleElement)
    .filter((node) => {
      const text = readRichText(node).toLowerCase()
      return text.startsWith("you said:") || text.startsWith("you:")
    })

  return articleMatches.at(-1) ?? null
}

export function readChatGptAssistantText(node: HTMLElement | null) {
  return readRichText(node)
}

export function readChatGptUserText(node: HTMLElement | null) {
  return readRichText(node)
}
