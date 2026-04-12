import type { ArtifactContext, ReviewContract } from "@prompt-optimizer/shared"

export type PromptSurfaceId = "chatgpt" | "replit"

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
