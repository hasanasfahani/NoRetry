import type { NextApiRequest, NextApiResponse } from "next"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ""
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  ""

const supabase =
  supabaseUrl && supabaseKey
    ? createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false
        }
      })
    : null

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

  if (!supabase) {
    return response.status(500).json({ error: "Supabase is not configured correctly." })
  }

  const normalizedEmail = email.toLowerCase()

  const { error } = await supabase.from("waitlist_signups").insert({
    name,
    email: normalizedEmail,
    source: "reeva-ai-demo-web"
  })

  if (error) {
    if (error.code === "23505") {
      return response.status(200).json({
        success: true,
        message: "You’re already on the list."
      })
    }

    if (error.code === "42501") {
      return response.status(500).json({
        error: "Supabase blocked the insert. Add an INSERT policy for waitlist_signups or use SUPABASE_SERVICE_ROLE_KEY."
      })
    }

    return response.status(500).json({
      error: `Unable to join the waitlist right now. (${error.message})`
    })
  }

  return response.status(200).json({
    success: true,
    message: "You’re on the list."
  })
}
