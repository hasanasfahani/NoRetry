import { NextResponse } from "next/server"
import { ZodTypeAny } from "zod"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
}

export async function parseJson<T>(request: Request, schema: ZodTypeAny): Promise<T> {
  const rawBody = await request.text()

  let body: unknown
  try {
    body = JSON.parse(rawBody)
  } catch (error) {
    const preview = rawBody.slice(0, 220).replace(/\s+/g, " ")
    throw new Error(
      `${error instanceof Error ? error.message : "Invalid JSON"} | Raw body preview: ${preview || "<empty>"}`
    )
  }

  if (
    body &&
    typeof body === "object" &&
    "__po_encoded_body" in body &&
    typeof (body as { __po_encoded_body?: unknown }).__po_encoded_body === "string"
  ) {
    try {
      const decoded = Buffer.from((body as { __po_encoded_body: string }).__po_encoded_body, "base64").toString("utf8")
      body = JSON.parse(decoded)
    } catch (error) {
      throw new Error(`Invalid encoded payload: ${error instanceof Error ? error.message : "Unknown decode error"}`)
    }
  }

  return schema.parse(body)
}

export function ok(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    status: 200,
    ...init,
    headers: {
      ...corsHeaders,
      ...(init?.headers ?? {})
    }
  })
}

export function badRequest(message: string, status = 400) {
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: corsHeaders
    }
  )
}

export function options() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders
  })
}
