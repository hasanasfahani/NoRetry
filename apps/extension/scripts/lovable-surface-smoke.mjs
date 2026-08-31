import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { build } from "esbuild"

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const extensionRoot = path.resolve(scriptDir, "..")

class FakeElement {
  constructor({
    text = "",
    className = "",
    attrs = {},
    rect = { top: 120, left: 80, width: 640, height: 180 },
    region = null
  } = {}) {
    this.innerText = text
    this.textContent = text
    this.className = className
    this.id = attrs.id ?? ""
    this._attrs = attrs
    this._rect = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height
    }
    this._region = region
  }

  getAttribute(name) {
    return this._attrs[name] ?? null
  }

  querySelectorAll() {
    return []
  }

  querySelector() {
    return null
  }

  closest(selector) {
    const selectors = selector.split(",").map((value) => value.trim())
    if (
      this._region === "nav" &&
      selectors.some((value) => value === "nav" || value === "header" || value === "aside" || value === "footer" || value === "[role='navigation']")
    ) {
      return this
    }

    if (
      this._region === "search" &&
      selectors.some((value) => value === "[role='search']")
    ) {
      return this
    }

    return null
  }

  getBoundingClientRect() {
    return this._rect
  }
}

class FakeDocument {
  constructor(selectors = {}, title = "") {
    this._selectors = selectors
    this.title = title
    this.body = { childElementCount: 1 }
    this.activeElement = null
  }

  querySelectorAll(selector) {
    return this._selectors[selector] ?? []
  }

  querySelector(selector) {
    return (this.querySelectorAll(selector)[0] ?? null)
  }

  getElementById() {
    return null
  }
}

async function bundleEntries(outdir, define = {}) {
  await build({
    entryPoints: [
      path.resolve(extensionRoot, "lib/replit.ts"),
      path.resolve(extensionRoot, "lib/lovable.ts"),
      path.resolve(extensionRoot, "lib/surfaces/lovable/adapter.ts")
    ],
    outdir,
    bundle: true,
    format: "esm",
    platform: "node",
    define
  })
}

function installBrowserGlobals(document, href = "https://lovable.dev/projects/demo/app") {
  globalThis.HTMLElement = FakeElement
  globalThis.HTMLInputElement = class extends FakeElement {}
  globalThis.HTMLTextAreaElement = class extends FakeElement {}
  globalThis.document = document
  globalThis.window = {
    location: new URL(href),
    innerHeight: 900,
    innerWidth: 1440,
    getComputedStyle() {
      return {
        visibility: "visible",
        display: "block",
        opacity: "1"
      }
    }
  }
}

async function importModule(outdir, relativePath) {
  return import(pathToFileURL(path.join(outdir, relativePath)).href)
}

async function main() {
  const outdir = await mkdtemp(path.join(os.tmpdir(), "lovable-surface-smoke-"))
  const outdirDisabled = await mkdtemp(path.join(os.tmpdir(), "lovable-surface-disabled-"))

  try {
    await bundleEntries(outdir)
    await bundleEntries(outdirDisabled, {
      "process.env.PLASMO_PUBLIC_ENABLE_LOVABLE": '"false"'
    })

    const mainNode = new FakeElement({
      text: "Preview ready Registration form now includes a gender field and keeps the rest of the flow unchanged.",
      attrs: { "data-testid": "preview-panel" },
      rect: { top: 120, left: 60, width: 760, height: 220 }
    })
    const navNode = new FakeElement({
      text: "Settings Share Publish",
      region: "nav",
      rect: { top: 0, left: 0, width: 1440, height: 72 }
    })
    const headingNode = new FakeElement({
      text: "Prompt Strength Hub",
      rect: { top: 84, left: 60, width: 420, height: 44 }
    })
    const document = new FakeDocument(
      {
        main: [mainNode],
        "[role='main']": [],
        article: [],
        section: [],
        "[data-testid*='preview']": [mainNode],
        "[data-testid*='result']": [],
        h1: [headingNode],
        "[data-testid*='project']": [],
        "[class*='project']": [],
        title: [],
        pre: [],
        code: [],
        "[role='alert']": [],
        ".error": [],
        header: [navNode],
        nav: [navNode],
        aside: [],
        footer: [],
        "[role='navigation']": [],
        "[role='search']": []
      },
      "Prompt Strength Hub"
    )

    installBrowserGlobals(document)

    const replitModule = await importModule(outdir, "replit.js")
    const lovableModule = await importModule(outdir, "lovable.js")
    const adapterModule = await importModule(outdir, "surfaces/lovable/adapter.js")

    assert.equal(replitModule.getPromptSurface({ hostname: "lovable.dev" }), "LOVABLE")
    assert.equal(replitModule.isSupportedPromptPage({ hostname: "lovable.dev" }), true)
    assert.equal(replitModule.isLovableSupportEnabled(), true)

    const snippet = lovableModule.collectLovableVisibleOutputSnippet("Updated the registration flow.")
    assert.match(snippet, /gender field/i)

    const projectLabel = lovableModule.readLovableProjectLabel()
    assert.equal(projectLabel, "Prompt Strength Hub")

    const thread = adapterModule.lovableSurfaceAdapter.getThread()
    assert.equal(thread.identity, "https://lovable.dev/projects/demo/app")

    const artifactContext = await adapterModule.lovableSurfaceAdapter.collectDeepArtifacts({
      responseText: "Updated the registration flow.",
      reviewContract: null
    })

    assert.equal(artifactContext.surface, "lovable")
    assert.equal(artifactContext.mode, "passive")
    assert.ok(artifactContext.artifacts.some((artifact) => artifact.type === "response_text"))
    assert.ok(artifactContext.artifacts.some((artifact) => artifact.type === "visible_output_snippet"))
    assert.ok(
      artifactContext.artifacts.every((artifact) => artifact.metadata.project_label === "Prompt Strength Hub"),
      "Lovable artifacts should retain project label metadata when available"
    )

    const replitDisabledModule = await importModule(outdirDisabled, "replit.js")
    assert.equal(replitDisabledModule.isLovableSupportEnabled(), false)
    assert.equal(replitDisabledModule.isSupportedPromptPage({ hostname: "lovable.dev" }), false)

    console.log("lovable-surface-smoke: ok")
  } finally {
    await rm(outdir, { recursive: true, force: true })
    await rm(outdirDisabled, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
