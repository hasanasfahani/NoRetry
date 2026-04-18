import {
  createEmptyAssistantResponseSnapshot,
  createEmptyArtifactContext,
  createEmptyDraftPromptSnapshot,
  createEmptyUserPromptSnapshot,
  createPanelMountContext,
  createThreadSnapshot,
  type SurfaceAdapter
} from "../adapter"
import {
  collectChangedFilesSummary,
  collectVisibleErrorSummary,
  collectVisibleOutputSnippet,
  findPromptInput,
  findSubmitButton,
  readPromptValue,
  writePromptValue
} from "../../replit"
import {
  deriveProjectMemoryIdentity,
  getDeepArtifactTelemetry,
  getGlobalPopupArtifactTelemetry
} from "../../storage"
import type { ArtifactContext, ArtifactRecord, ReviewContract } from "@prompt-optimizer/shared"

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
  const leftInConversation = conversationContainer ? conversationContainer.contains(left) : false
  const rightInConversation = conversationContainer ? conversationContainer.contains(right) : false

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
    const activeNode: HTMLElement = current
    const parent: HTMLElement | null = activeNode.parentElement
    const tag = activeNode.tagName.toLowerCase()
    const index =
      parent == null
        ? 0
        : Array.from(parent.children)
            .filter((child): child is HTMLElement => child instanceof HTMLElement)
            .filter((child) => child.tagName === activeNode.tagName)
            .indexOf(activeNode)
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

function extractCodeBlocks(text: string) {
  return [...text.matchAll(/```[\s\S]*?```/g)].map((match) => match[0].trim()).filter(Boolean)
}

function limitText(value: string, limit: number) {
  if (value.length <= limit) return value
  return `${value.slice(0, limit - 1).trimEnd()}…`
}

function createArtifact(
  type: ArtifactRecord["type"],
  surfaceScope: string,
  content: string,
  metadata: ArtifactRecord["metadata"] = {},
  source = "replit_surface"
): ArtifactRecord | null {
  const trimmed = content.trim()
  if (!trimmed) return null

  return {
    type,
    source,
    captured_at: new Date().toISOString(),
    surface_scope: surfaceScope,
    content: limitText(trimmed, 12000),
    metadata
  }
}

function findVisibleTextMatches(pattern: RegExp, selectors: string[]) {
  const seen = new Set<string>()
  const matches: string[] = []

  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (!isVisibleElement(element)) continue
      if (element.closest("#prompt-optimizer-root")) continue
      const text = element.innerText.trim()
      if (!text || !pattern.test(text)) continue
      const limited = limitText(text, 500)
      if (seen.has(limited)) continue
      seen.add(limited)
      matches.push(limited)
      if (matches.length >= 3) return matches
    }
  }

  return matches
}

function collectVisibleBuildOrTestText() {
  return findVisibleTextMatches(
    /\b(build|built|compile|compiled|typecheck|test|tests|passed|failing|failed|vite|webpack|next build|npm run)\b/i,
    ["pre", "code", "[role='log']", "[data-testid*='output' i]", "[class*='output' i]", "[class*='console' i]", "section", "article", "main"]
  ).join("\n\n")
}

function collectVisibleRuntimeSignalsText() {
  return findVisibleTextMatches(
    /\b(error|errors|warning|warnings|passed|success|console|runtime|traceback|exception)\b/i,
    ["pre", "code", "[role='alert']", "[role='status']", "[data-testid*='output' i]", "[class*='console' i]", "section", "article", "main"]
  ).join("\n\n")
}

function findVisibleElementByText(pattern: RegExp, selectors: string[]) {
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      if (!isVisibleElement(element)) continue
      if (element.closest("#prompt-optimizer-root")) continue
      if (pattern.test(element.innerText.trim())) return element
    }
  }

  return null
}

function buildDomObservationArtifacts(reviewContract: ReviewContract | null): ArtifactRecord[] {
  const artifacts: ArtifactRecord[] = []
  const textarea = findPromptInput()
  const textareaRect = textarea?.getBoundingClientRect() ?? null

  const pushObservation = (
    probeId: string,
    target: string,
    observed: boolean,
    confidence: number,
    details: string
  ) => {
    const artifact = createArtifact(
      "dom_observations",
      "replit_dom",
      `${probeId}: ${observed ? "observed" : "not_observed"} - ${details}`,
      {
        probe_id: probeId,
        target,
        observed,
        confidence,
        details
      }
    )
    if (artifact) artifacts.push(artifact)
  }

  pushObservation(
    "prompt_textarea_found",
    "prompt_textarea",
    Boolean(textarea),
    textarea ? 0.95 : 0.4,
    textarea ? "Found a prompt input on the page." : "Could not find the current prompt textarea."
  )

  const launcher = findVisibleElementByText(/\b(strength|optimi[sz]e|improve prompt|launcher)\b/i, ["button", "[role='button']", "span", "div"])
  const launcherNearTextarea =
    Boolean(launcher && textareaRect) &&
    (() => {
      const rect = launcher!.getBoundingClientRect()
      return Math.abs(rect.top - textareaRect!.top) < 120 && Math.abs(rect.left - textareaRect!.right) < 220
    })()
  pushObservation(
    "launcher_near_textarea",
    "inline_launcher",
    launcherNearTextarea,
    launcherNearTextarea ? 0.8 : launcher ? 0.55 : 0.35,
    launcherNearTextarea
      ? "Found a likely optimize/strength launcher near the prompt textarea."
      : launcher
      ? "Found a likely optimize/strength control, but not confidently near the prompt textarea."
      : "No likely optimize/strength launcher was visible near the prompt textarea."
  )

  const optimizePanel = findVisibleElementByText(/\b(optimi[sz]e|clarif|follow-up|acceptance criteria|strength badge)\b/i, ["aside", "dialog", "section", "[role='dialog']", "[class*='panel' i]", "[class*='drawer' i]"])
  pushObservation(
    "optimize_panel_visible",
    "optimize_panel",
    Boolean(optimizePanel),
    optimizePanel ? 0.8 : 0.35,
    optimizePanel ? "Found a likely optimize panel or drawer." : "No optimize panel was visibly open."
  )

  const strengthBadge = findVisibleElementByText(/\b(red|yellow|green|strength)\b/i, ["span", "div", "button", "section", "aside", "[role='dialog']"])
  pushObservation(
    "strength_badge_visible",
    "strength_badge",
    Boolean(strengthBadge),
    strengthBadge ? 0.72 : 0.35,
    strengthBadge ? "Found visible strength-related badge text." : "No visible strength badge text was found."
  )

  const questionUi = findVisibleElementByText(/\b(question|questions|follow-up|clarification)\b/i, ["aside", "dialog", "section", "[role='dialog']", "main"])
  pushObservation(
    "question_ui_visible",
    "question_flow",
    Boolean(questionUi),
    questionUi ? 0.72 : 0.35,
    questionUi ? "Found visible question or follow-up UI text." : "No question or follow-up UI was visible."
  )

  const replaceButton = findVisibleElementByText(/\breplace\b/i, ["button", "[role='button']"])
  pushObservation(
    "replace_button_visible",
    "replace_button",
    Boolean(replaceButton),
    replaceButton ? 0.78 : 0.35,
    replaceButton ? "Found a visible Replace button." : "No visible Replace button was found."
  )

  const promptValue = textarea ? readPromptValue(textarea).trim() : ""
  pushObservation(
    "improved_prompt_visible_in_textarea",
    "prompt_textarea_content",
    Boolean(promptValue.length > 20),
    promptValue.length > 20 ? 0.62 : 0.3,
    promptValue.length > 20
      ? "Prompt textarea currently contains visible prompt text."
      : "Prompt textarea did not show enough visible prompt text to confirm replacement."
  )

  const popup = findVisibleElementByText(/\b(auth state|usage|strengthen|prompt optimizer|noretry|reeva ai)\b/i, ["dialog", "aside", "section", "[role='dialog']", "[class*='popup' i]"])
  pushObservation(
    "popup_visible",
    "extension_popup",
    Boolean(popup),
    popup ? 0.7 : 0.32,
    popup ? "Found likely extension popup content." : "No extension popup content was visibly open."
  )

  const authState = findVisibleElementByText(/\b(auth state|signed in|sign in|logged in|login)\b/i, ["dialog", "aside", "section", "main"])
  pushObservation(
    "auth_state_visible",
    "auth_state",
    Boolean(authState),
    authState ? 0.7 : 0.32,
    authState ? "Found visible auth/sign-in state text." : "No auth/sign-in state text was visible."
  )

  const usage = findVisibleElementByText(/\b(usage|credits|quota)\b/i, ["dialog", "aside", "section", "main"])
  pushObservation(
    "usage_visible",
    "usage",
    Boolean(usage),
    usage ? 0.7 : 0.32,
    usage ? "Found visible usage/credits/quota text." : "No usage/credits text was visible."
  )

  const strengthen = findVisibleElementByText(/\bstrengthen\b/i, ["dialog", "aside", "section", "button", "[role='tab']", "[role='button']"])
  pushObservation(
    "strengthen_flow_visible",
    "strengthen_flow",
    Boolean(strengthen),
    strengthen ? 0.62 : 0.3,
    strengthen ? "Found visible Strengthen flow/tab text." : "No visible Strengthen flow/tab text was found."
  )

  if (reviewContract?.criteria.some((criterion) => /spa navigation|re-appears|survive/i.test(criterion.label))) {
    const nav = findVisibleElementByText(/\b(navigation|re-appear|reappear|stays visible)\b/i, ["main", "section", "article", "pre", "code"])
    pushObservation(
      "spa_navigation_signal_visible",
      "spa_navigation",
      Boolean(nav),
      nav ? 0.45 : 0.2,
      nav ? "Found visible navigation-related signal text." : "No visible SPA navigation proof was present."
    )
  }

  return artifacts
}

async function buildTelemetryArtifacts() {
  const artifacts: ArtifactRecord[] = []
  const { key: projectKey } = deriveProjectMemoryIdentity()
  const [telemetry, popupTelemetry] = await Promise.all([
    getDeepArtifactTelemetry(projectKey),
    getGlobalPopupArtifactTelemetry()
  ])
  const now = Date.now()
  const maxAgeMs = 1000 * 60 * 30

  const recentEvents = (telemetry?.events ?? []).filter((event) => {
    const capturedAt = Date.parse(event.capturedAt)
    return Number.isFinite(capturedAt) && now - capturedAt <= maxAgeMs
  })

  for (const event of recentEvents.slice(-12)) {
    const artifact = createArtifact(
      "extension_event_trace",
      "extension_runtime",
      `${event.eventType}: ${event.detail}`,
      {
        event_type: event.eventType,
        status: event.status,
        route: event.route ?? "",
        thread_identity: event.threadIdentity ?? "",
        response_identity: event.responseIdentity ?? ""
      },
      "extension_telemetry"
    )
    if (artifact) artifacts.push(artifact)
  }

  const recentPopupSnapshots = (popupTelemetry?.popupSnapshots ?? []).filter((snapshot) => {
    const capturedAt = Date.parse(snapshot.capturedAt)
    return Number.isFinite(capturedAt) && now - capturedAt <= maxAgeMs
  })

  const latestPopupSnapshot = recentPopupSnapshots[recentPopupSnapshots.length - 1]
  if (latestPopupSnapshot) {
    const popupArtifact = createArtifact(
      "popup_state_snapshot",
      "extension_popup",
      latestPopupSnapshot.visibleText,
      {
        status_text: latestPopupSnapshot.statusText,
        retry_count: latestPopupSnapshot.retryCount,
        last_intent: latestPopupSnapshot.lastIntent,
        auth_state_text: latestPopupSnapshot.authStateText ?? "",
        usage_text: latestPopupSnapshot.usageText ?? "",
        strengthen_visible: latestPopupSnapshot.strengthenVisible ?? false,
        host_hint: latestPopupSnapshot.hostHint ?? ""
      },
      "popup_telemetry"
    )
    if (popupArtifact) artifacts.push(popupArtifact)
  }

  return artifacts
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
        conversationContainer != null &&
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
  },
  async collectDeepArtifacts(input) {
    const responseText = input.responseText.trim()
    if (!responseText) return createEmptyArtifactContext("replit")

    const artifacts: ArtifactRecord[] = []
    const responseArtifact = createArtifact("response_text", "latest_assistant_response", responseText)
    if (responseArtifact) artifacts.push(responseArtifact)

    const codeBlocks = extractCodeBlocks(responseText)
    if (codeBlocks.length) {
      const codeArtifact = createArtifact(
        "response_code_blocks",
        "latest_assistant_response",
        codeBlocks.join("\n\n"),
        { block_count: codeBlocks.length }
      )
      if (codeArtifact) artifacts.push(codeArtifact)
    }

    const changedFiles = collectChangedFilesSummary()
    if (changedFiles.length) {
      const changedFilesArtifact = createArtifact(
        "changed_file_labels",
        "workspace_surface",
        changedFiles.join("\n"),
        { file_count: changedFiles.length }
      )
      if (changedFilesArtifact) artifacts.push(changedFilesArtifact)
    }

    const outputSnippet = collectVisibleOutputSnippet()
    const outputArtifact = createArtifact("visible_output_snippet", "workspace_surface", outputSnippet)
    if (outputArtifact) artifacts.push(outputArtifact)

    const errorSummary = collectVisibleErrorSummary()
    const errorArtifact = createArtifact("visible_error_summary", "workspace_surface", errorSummary ?? "")
    if (errorArtifact) artifacts.push(errorArtifact)

    const buildOrTestText = collectVisibleBuildOrTestText()
    const buildArtifact = createArtifact("visible_build_or_test_text", "workspace_surface", buildOrTestText)
    if (buildArtifact) artifacts.push(buildArtifact)

    const runtimeSignals = collectVisibleRuntimeSignalsText()
    const runtimeArtifact = createArtifact("visible_runtime_signals", "workspace_surface", runtimeSignals)
    if (runtimeArtifact) artifacts.push(runtimeArtifact)

    artifacts.push(...buildDomObservationArtifacts(input.reviewContract))
    artifacts.push(...(await buildTelemetryArtifacts()))

    return {
      mode: "passive",
      surface: "replit",
      artifacts
    } satisfies ArtifactContext
  }
}
