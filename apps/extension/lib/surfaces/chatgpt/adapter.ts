import {
  createEmptyAssistantResponseSnapshot,
  createEmptyArtifactContext,
  createEmptyDraftPromptSnapshot,
  createEmptyUserPromptSnapshot,
  createPanelMountContext,
  createThreadSnapshot,
  type SurfaceAdapter
} from "../adapter"
import { findPromptInput, findSubmitButton, readPromptValue, writePromptValue } from "../../replit"
import {
  findLatestChatGptAssistantMessage,
  findLatestChatGptUserMessage,
  readChatGptAssistantText,
  readChatGptUserText
} from "../../after/chatgpt"

function readMessageIdentity(node: HTMLElement | null, fallbackText = "") {
  if (!node) return fallbackText.trim().slice(0, 120)

  const explicitId =
    node.getAttribute("data-message-id") ||
    node.getAttribute("data-id") ||
    node.id ||
    node.closest<HTMLElement>("[data-message-id]")?.getAttribute("data-message-id") ||
    node.closest<HTMLElement>("[data-id]")?.getAttribute("data-id") ||
    node.closest<HTMLElement>("[id]")?.id

  return explicitId || fallbackText.trim().slice(0, 120)
}

export const chatGptSurfaceAdapter: SurfaceAdapter = {
  id: "chatgpt",
  label: "ChatGPT",
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
    const node = findLatestChatGptAssistantMessage()
    const text = readChatGptAssistantText(node)
    if (!node || !text) return createEmptyAssistantResponseSnapshot()

    return {
      exists: true,
      text,
      identity: readMessageIdentity(node, text),
      node
    }
  },
  getLatestUserPrompt() {
    const node = findLatestChatGptUserMessage()
    const text = readChatGptUserText(node)
    if (!node || !text) return createEmptyUserPromptSnapshot()

    return {
      exists: true,
      text,
      node
    }
  },
  getThread() {
    return createThreadSnapshot(window.location.href)
  },
  getPanelMountContext() {
    return createPanelMountContext(findPromptInput())
  },
  collectDeepArtifacts(input) {
    return input.responseText.trim()
      ? {
          mode: "passive",
          surface: "chatgpt",
          artifacts: [
            {
              type: "response_text",
              source: "surface_adapter",
              captured_at: new Date().toISOString(),
              surface_scope: "latest_assistant_response",
              content: input.responseText.trim(),
              metadata: {}
            }
          ]
        }
      : createEmptyArtifactContext("chatgpt")
  }
}
