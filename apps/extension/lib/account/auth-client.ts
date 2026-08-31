import {
  AuthMeResponseSchema,
  AuthResponseSchema,
  type LoginAccountRequest,
  type RefreshAccountRequest,
  type RegisterAccountRequest
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
  method?: "GET" | "POST"
  body?: unknown
  bearerToken?: string
  parse: (value: unknown) => T
}) {
  let lastError: Error | null = null

  for (const apiBase of getApiBases()) {
    const controller = new AbortController()
    const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(`${apiBase}${input.path}`, {
        method: input.method ?? "POST",
        headers: {
          "Content-Type": "application/json",
          ...(input.bearerToken ? { Authorization: `Bearer ${input.bearerToken}` } : {})
        },
        body: input.body === undefined ? undefined : JSON.stringify(input.body),
        signal: controller.signal
      })

      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(typeof payload?.error === "string" ? payload.error : "Request failed")
      }

      return input.parse(payload)
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        lastError = new Error("The account request timed out before the server responded.")
      } else if (error instanceof TypeError && /fetch/i.test(error.message)) {
        lastError = new Error(
          API_BASE.startsWith("http://localhost") || API_BASE.startsWith("http://127.0.0.1")
            ? `Could not reach the local API at ${apiBase}. Start the API with: npm run dev:api`
            : `Could not reach the API at ${apiBase}.`
        )
      } else {
        lastError = error instanceof Error ? error : new Error("Request failed")
      }
    } finally {
      window.clearTimeout(timeoutId)
    }
  }

  throw lastError ?? new Error("Request failed")
}

export function registerAccount(input: RegisterAccountRequest) {
  return requestJson({
    path: "/api/auth/register",
    body: input,
    parse: (value) => AuthResponseSchema.parse(value)
  })
}

export function loginAccount(input: LoginAccountRequest) {
  return requestJson({
    path: "/api/auth/login",
    body: input,
    parse: (value) => AuthResponseSchema.parse(value)
  })
}

export function refreshAccount(input: RefreshAccountRequest) {
  return requestJson({
    path: "/api/auth/refresh",
    body: input,
    parse: (value) => AuthResponseSchema.parse(value)
  })
}

export function getCurrentAccount(accessToken: string) {
  return requestJson({
    path: "/api/auth/me",
    method: "GET",
    bearerToken: accessToken,
    parse: (value) => AuthMeResponseSchema.parse(value)
  })
}

export function logoutAccount(accessToken: string) {
  return requestJson({
    path: "/api/auth/logout",
    body: { accessToken },
    bearerToken: accessToken,
    parse: (value) => value as { success: boolean }
  })
}
