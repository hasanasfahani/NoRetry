export function findLatestChatGptAssistantMessage() {
  const messages = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"]'))
  return messages.at(-1) ?? null
}

export function findLatestChatGptUserMessage() {
  const messages = Array.from(document.querySelectorAll<HTMLElement>('[data-message-author-role="user"]'))
  return messages.at(-1) ?? null
}

export function readChatGptAssistantText(node: HTMLElement | null) {
  return node?.innerText.trim() ?? ""
}

export function readChatGptUserText(node: HTMLElement | null) {
  return node?.innerText.trim() ?? ""
}
