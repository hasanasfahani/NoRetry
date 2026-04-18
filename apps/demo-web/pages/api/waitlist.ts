import type { NextApiRequest, NextApiResponse } from "next"

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  ""

type SupabaseRestError = {
  code?: string
  message?: string
}

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

  if (!supabaseUrl || !supabaseKey) {
    return response.status(500).json({ error: "Supabase is not configured correctly." })
  }

  const normalizedEmail = email.toLowerCase()
  const restResponse = await fetch(`${supabaseUrl}/rest/v1/waitlist_signups`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: "return=minimal"
    },
    body: JSON.stringify({
      name,
      email: normalizedEmail,
      source: "reeva-ai-demo-web"
    })
  })

  if (!restResponse.ok) {
    const error = (await restResponse.json().catch(() => null)) as SupabaseRestError | null
    const errorCode = error?.code || ""
    const errorMessage = error?.message || ""

    if (restResponse.status === 409 || errorCode === "23505" || /duplicate key/i.test(errorMessage)) {
      return response.status(200).json({
        success: true,
        message: "You’re already on the list."
      })
    }

    if (restResponse.status === 401 || restResponse.status === 403 || errorCode === "42501") {
      return response.status(500).json({
        error: "Supabase blocked the insert. Add an INSERT policy for waitlist_signups or use SUPABASE_SERVICE_ROLE_KEY."
      })
    }

    return response.status(500).json({
      error: `Unable to join the waitlist right now. (${errorMessage || `HTTP ${restResponse.status}`})`
    })
  }

  return response.status(200).json({
    success: true,
    message: "You’re on the list."
  })
}
