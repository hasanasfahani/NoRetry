import {
  CreateProjectActivityRequestSchema,
  CreateProjectContextImportRequestSchema,
  ProjectListResponseSchema,
  ProjectStateSchema,
  UpsertProjectProgressRequestSchema,
  UpsertProjectMemoryRequestSchema,
  UpsertProjectPreferencesRequestSchema,
  type CreateProjectActivityRequest,
  type CreateProjectContextImportRequest,
  type ProjectState,
  type UpsertProjectMemoryRequest,
  type UpsertProjectProgressRequest,
  type UpsertProjectPreferencesRequest
} from "@prompt-optimizer/shared"

const API_BASE = process.env.PLASMO_PUBLIC_API_BASE_URL || "https://noretry.vercel.app"
const REQUEST_TIMEOUT_MS = 15000

function getApiBases() {
  const bases = [API_BASE]
  if (API_BASE.includes("localhost")) {
    bases.push(API_BASE.replace("localhost", "127.0.0.1"))
  }

  return [...new Set(bases)]
}

async function requestJson<T>(input: {
  path: string
  method?: "GET" | "POST" | "PUT"
  body?: unknown
  bearerToken: string
  parse: (value: unknown) => T
}) {
  let lastError: Error | null = null

  for (const apiBase of getApiBases()) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${apiBase}${input.path}`, {
        method: input.method ?? "GET",
        headers: {
          Authorization: `Bearer ${input.bearerToken}`,
          ...(input.body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Project sync request failed")
      }

      return input.parse(payload)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error("The project sync request timed out before the server responded.")
      } else if (error instanceof TypeError && /fetch/i.test(error.message)) {
        lastError = new Error(
          API_BASE.startsWith("http://localhost") || API_BASE.startsWith("http://127.0.0.1")
            ? `Could not reach the local API at ${apiBase}. Start the API with: npm run dev:api`
            : `Could not reach the API at ${apiBase}.`
        )
      } else {
        lastError = error instanceof Error ? error : new Error("Project sync request failed")
      }
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  throw lastError ?? new Error("Project sync request failed")
}

function encodeProjectKey(projectKey: string) {
  return encodeURIComponent(projectKey)
}

export function listProjects(accessToken: string) {
  return requestJson({
    path: "/api/projects",
    method: "GET",
    bearerToken: accessToken,
    parse: (value) => ProjectListResponseSchema.parse(value)
  })
}

export function getProject(projectKey: string, accessToken: string) {
  return requestJson({
    path: `/api/projects/${encodeProjectKey(projectKey)}`,
    method: "GET",
    bearerToken: accessToken,
    parse: (value) => ProjectStateSchema.parse(value)
  })
}

export function syncProjectMemory(projectKey: string, accessToken: string, body: UpsertProjectMemoryRequest): Promise<ProjectState> {
  return requestJson({
    path: `/api/projects/${encodeProjectKey(projectKey)}/memory`,
    method: "PUT",
    bearerToken: accessToken,
    body: UpsertProjectMemoryRequestSchema.parse(body),
    parse: (value) => ProjectStateSchema.parse(value)
  })
}

export function syncProjectPreferences(
  projectKey: string,
  accessToken: string,
  body: UpsertProjectPreferencesRequest
): Promise<ProjectState> {
  return requestJson({
    path: `/api/projects/${encodeProjectKey(projectKey)}/preferences`,
    method: "PUT",
    bearerToken: accessToken,
    body: UpsertProjectPreferencesRequestSchema.parse(body),
    parse: (value) => ProjectStateSchema.parse(value)
  })
}

export function syncProjectContextImport(
  projectKey: string,
  accessToken: string,
  body: CreateProjectContextImportRequest
): Promise<ProjectState> {
  return requestJson({
    path: `/api/projects/${encodeProjectKey(projectKey)}/context-import`,
    method: "POST",
    bearerToken: accessToken,
    body: CreateProjectContextImportRequestSchema.parse(body),
    parse: (value) => ProjectStateSchema.parse(value)
  })
}

export function syncProjectProgress(
  projectKey: string,
  accessToken: string,
  body: UpsertProjectProgressRequest
): Promise<ProjectState> {
  return requestJson({
    path: `/api/projects/${encodeProjectKey(projectKey)}/progress`,
    method: "PUT",
    bearerToken: accessToken,
    body: UpsertProjectProgressRequestSchema.parse(body),
    parse: (value) => ProjectStateSchema.parse(value)
  })
}

export function logProjectActivity(
  projectKey: string,
  accessToken: string,
  body: CreateProjectActivityRequest
) {
  return requestJson({
    path: `/api/projects/${encodeProjectKey(projectKey)}/activity`,
    method: "POST",
    bearerToken: accessToken,
    body: CreateProjectActivityRequestSchema.parse(body),
    parse: (value) => value
  })
}
