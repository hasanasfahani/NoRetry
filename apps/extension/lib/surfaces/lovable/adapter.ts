import {
  createEmptyAssistantResponseSnapshot,
  createEmptyArtifactContext,
  createEmptyDraftPromptSnapshot,
  createEmptyUserPromptSnapshot,
  createPanelMountContext,
  createThreadSnapshot,
  getGenericAnswerCompletionState,
  type SurfaceAdapter
} from "../adapter"
import {
  collectVisibleErrorSummary,
  findPromptInput,
  findSubmitButton,
  readPromptValue,
  writePromptValue
} from "../../replit"
import {
  collectLovableVisibleOutputSnippet,
  findLatestLovableAssistantMessage,
  findLatestLovableUserMessage,
  readLovableProjectLabel,
  readLovableAssistantText,
  readLovableMessageIdentity,
  readLovableUserText
} from "../../lovable"
import type { ArtifactContext, ArtifactRecord } from "@prompt-optimizer/shared"

export const lovableSurfaceAdapter: SurfaceAdapter = {
  id: "lovable",
  label: "Lovable",
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
    const promptInput = findPromptInput()
    const node = findLatestLovableAssistantMessage(promptInput)
    const text = readLovableAssistantText(node)
    if (!node || !text) return createEmptyAssistantResponseSnapshot()

    return {
      exists: true,
      text,
      identity: readLovableMessageIdentity(node, text),
      node
    }
  },
  getAnswerCompletionState() {
    return getGenericAnswerCompletionState({
      assistantExists: this.getLatestAssistantResponse().exists,
      submitButton: this.getDraftPrompt().submitButton
    })
  },
  getLatestUserPrompt() {
    const promptInput = findPromptInput()
    const node = findLatestLovableUserMessage(promptInput)
    const text = readLovableUserText(node)
    if (!node || !text) return createEmptyUserPromptSnapshot()

    return {
      exists: true,
      text,
      node
    }
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
  },
  async collectDeepArtifacts(input) {
    const responseText = input.responseText.trim()
    const outputSnippet = collectLovableVisibleOutputSnippet(responseText)
    const visibleError = collectVisibleErrorSummary()
    const projectLabel = readLovableProjectLabel()

    if (!responseText && !outputSnippet && !visibleError) return createEmptyArtifactContext("lovable")

    const artifacts: ArtifactRecord[] = []

    if (responseText) {
      artifacts.push({
        type: "response_text",
        source: "lovable_surface",
        captured_at: new Date().toISOString(),
        surface_scope: "latest_assistant_response",
        content: responseText,
        metadata: projectLabel ? { project_label: projectLabel } : {}
      })
    }

    if (outputSnippet) {
      artifacts.push({
        type: "visible_output_snippet",
        source: "lovable_surface",
        captured_at: new Date().toISOString(),
        surface_scope: "workspace_surface",
        content: outputSnippet,
        metadata: projectLabel ? { project_label: projectLabel } : {}
      })
    }

    if (visibleError) {
      artifacts.push({
        type: "visible_error_summary",
        source: "lovable_surface",
        captured_at: new Date().toISOString(),
        surface_scope: "workspace_surface",
        content: visibleError,
        metadata: projectLabel ? { project_label: projectLabel } : {}
      })
    }

    return {
      mode: "passive",
      surface: "lovable",
      artifacts
    } satisfies ArtifactContext
  }
}
