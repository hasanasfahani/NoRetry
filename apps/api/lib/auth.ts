import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"
import type { AuthUser } from "@prompt-optimizer/shared"

const scrypt = promisify(scryptCallback)

const PASSWORD_KEYLEN = 64
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

export function buildDisplayName(firstName: string, lastName: string) {
  return `${normalizeName(firstName)} ${normalizeName(lastName)}`.trim()
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex")
  const derived = (await scrypt(password, salt, PASSWORD_KEYLEN)) as Buffer
  return `scrypt:${salt}:${derived.toString("hex")}`
}

export async function verifyPassword(password: string, storedHash: string) {
  const [scheme, salt, expectedHex] = storedHash.split(":")
  if (scheme !== "scrypt" || !salt || !expectedHex) return false

  const expected = Buffer.from(expectedHex, "hex")
  const derived = (await scrypt(password, salt, expected.length)) as Buffer
  if (expected.length !== derived.length) return false
  return timingSafeEqual(expected, derived)
}

export function generateOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url")
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

export function buildSessionExpiry(from = Date.now()) {
  return new Date(from + SESSION_TTL_MS)
}

export function isExpired(value: string | Date) {
  const expiresAt = typeof value === "string" ? Date.parse(value) : value.getTime()
  return Number.isNaN(expiresAt) || expiresAt <= Date.now()
}

export function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? ""
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? ""
}

export function toAuthUser(user: {
  id: string
  email: string
  firstName: string
  lastName: string
  displayName: string | null
}): AuthUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: user.displayName?.trim() || buildDisplayName(user.firstName, user.lastName)
  }
}
