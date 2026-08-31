import type { ArtifactContext, ReviewContract } from "@prompt-optimizer/shared"

export type PromptSurfaceId = "chatgpt" | "replit" | "lovable"

export type DraftPromptSnapshot = {
  exists: boolean
  text: string
  input: HTMLElement | null
  submitButton: HTMLButtonElement | null
}

export type AssistantResponseSnapshot = {
  exists: boolean
  text: string
  identity: string
  node: HTMLElement | null
}

export type UserPromptSnapshot = {
  exists: boolean
  text: string
  node: HTMLElement | null
}

export type ThreadSnapshot = {
  href: string
  identity: string
}

export type AnswerCompletionState = {
  isStreamingActive: boolean
  assistantControlsVisible: boolean
  reason: string
}

export type PanelMountContext = {
  anchor: HTMLElement | null
  shouldOpenPlannerFirst: boolean
}

export interface SurfaceAdapter {
  id: PromptSurfaceId
  label: string
  getDraftPrompt(): DraftPromptSnapshot
  writeDraftPrompt(text: string): boolean
  getLatestAssistantResponse(): AssistantResponseSnapshot
  getAnswerCompletionState(): AnswerCompletionState
  getLatestUserPrompt(): UserPromptSnapshot
  getThread(): ThreadSnapshot
  getPanelMountContext(): PanelMountContext
  collectDeepArtifacts(input: {
    responseText: string
    reviewContract: ReviewContract | null
  }): Promise<ArtifactContext>
}

export function createEmptyDraftPromptSnapshot(): DraftPromptSnapshot {
  return {
    exists: false,
    text: "",
    input: null,
    submitButton: null
  }
}

export function createEmptyAssistantResponseSnapshot(): AssistantResponseSnapshot {
  return {
    exists: false,
    text: "",
    identity: "",
    node: null
  }
}

function isVisibleElement(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"
}

function queryVisible(selectors: string[]) {
  return selectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisibleElement))
}

export function getGenericAnswerCompletionState(input: {
  assistantExists: boolean
  submitButton?: HTMLButtonElement | null
}): AnswerCompletionState {
  const isStreamingActive = queryVisible([
    "[aria-label*='Stop' i]",
    "[data-testid*='stop' i]",
    "button[class*='stop' i]",
    "[aria-label*='generating' i]",
    "[aria-label*='thinking' i]",
    "[data-testid*='generating' i]"
  ])
  const assistantControlsVisible =
    input.assistantExists &&
    !isStreamingActive &&
    (queryVisible([
      "[aria-label*='Copy' i]",
      "[aria-label*='Retry' i]",
      "[aria-label*='Regenerate' i]",
      "[data-testid*='copy' i]",
      "[data-testid*='retry' i]",
      "[data-testid*='regenerate' i]"
    ]) ||
      Boolean(input.submitButton && !input.submitButton.disabled))

  return {
    isStreamingActive,
    assistantControlsVisible,
    reason: isStreamingActive
      ? "streaming_indicator_visible"
      : assistantControlsVisible
        ? "assistant_controls_visible"
        : input.assistantExists
          ? "assistant_present_without_controls"
          : "no_assistant_response"
  }
}

export function createEmptyUserPromptSnapshot(): UserPromptSnapshot {
  return {
    exists: false,
    text: "",
    node: null
  }
}

export function createThreadSnapshot(href = window.location.href, identity = href): ThreadSnapshot {
  return {
    href,
    identity
  }
}

export function createPanelMountContext(anchor: HTMLElement | null): PanelMountContext {
  return {
    anchor,
    shouldOpenPlannerFirst: false
  }
}

export function createEmptyArtifactContext(surface: ArtifactContext["surface"]): ArtifactContext {
  return {
    mode: "none",
    surface,
    artifacts: []
  }
}
