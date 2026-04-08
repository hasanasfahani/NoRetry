type ProxyRequestMessage = {
  type: "PROMPT_OPTIMIZER_PROXY"
  path: string
  body: string
}

const API_BASE = process.env.PLASMO_PUBLIC_API_BASE_URL || "http://localhost:3000"
const REQUEST_TIMEOUT_MS = 8000

function getApiBases() {
  const bases = [API_BASE]
  if (API_BASE.includes("localhost")) {
    bases.push(API_BASE.replace("localhost", "127.0.0.1"))
  }
  return [...new Set(bases)]
}

chrome.runtime.onMessage.addListener((message: ProxyRequestMessage, _sender, sendResponse) => {
  if (!message || message.type !== "PROMPT_OPTIMIZER_PROXY") {
    return false
  }

  void (async () => {
    try {
      let lastError: unknown = null

      for (const base of getApiBases()) {
        try {
          const controller = new AbortController()
          const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

          const response = await fetch(`${base}${message.path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: message.body,
            signal: controller.signal
          })

          clearTimeout(timeoutId)
          const text = await response.text()
          sendResponse({
            ok: response.ok,
            status: response.status,
            text
          })
          return
        } catch (error) {
          lastError = error
        }
      }

      sendResponse({
        ok: false,
        status: 0,
        text: lastError instanceof Error ? lastError.message : "Unknown proxy error"
      })
    }
  })()

  return true
})
