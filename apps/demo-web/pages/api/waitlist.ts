import type { NextApiRequest, NextApiResponse } from "next"

export default async function handler(request: NextApiRequest, response: NextApiResponse) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST")
    return response.status(405).json({ error: "Method not allowed." })
  }

  const name = typeof request.body?.name === "string" ? request.body.name.trim() : ""
  const email = typeof request.body?.email === "string" ? request.body.email.trim() : ""

  if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return response.status(400).json({ error: "Enter a valid name and email." })
  }

  const webhook = process.env.REEVA_WAITLIST_WEBHOOK_URL

  if (webhook) {
    await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        name,
        email,
        source: "reeva-ai-demo-web"
      })
    }).catch(() => null)
  }

  return response.status(200).json({
    success: true,
    message: "You’re on the list."
  })
}
