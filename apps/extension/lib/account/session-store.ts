import { Storage } from "@plasmohq/storage"
import type { AuthDevice, AuthSession, AuthUser } from "@prompt-optimizer/shared"

const storage = new Storage({ area: "local" })

const AUTH_SESSION_KEY = "reeva:auth:session"
const AUTH_USER_KEY = "reeva:auth:user"
const ANONYMOUS_DEVICE_ID_KEY = "reeva:device:anonymous-id"
const EXTENSION_INSTALL_ID_KEY = "reeva:device:install-id"

export async function getStoredSession() {
  return ((await storage.get<AuthSession>(AUTH_SESSION_KEY)) ?? null) as AuthSession | null
}

export async function getStoredUser() {
  return ((await storage.get<AuthUser>(AUTH_USER_KEY)) ?? null) as AuthUser | null
}

export async function saveStoredAuth(input: { user: AuthUser; session: AuthSession }) {
  await storage.set(AUTH_USER_KEY, input.user)
  await storage.set(AUTH_SESSION_KEY, input.session)
}

export async function clearStoredAuth() {
  await storage.remove(AUTH_USER_KEY)
  await storage.remove(AUTH_SESSION_KEY)
}

export async function getOrCreateAnonymousDeviceId() {
  const existing = await storage.get<string>(ANONYMOUS_DEVICE_ID_KEY)
  if (existing) return existing
  const next = crypto.randomUUID()
  await storage.set(ANONYMOUS_DEVICE_ID_KEY, next)
  return next
}

export async function getOrCreateExtensionInstallId() {
  const existing = await storage.get<string>(EXTENSION_INSTALL_ID_KEY)
  if (existing) return existing
  const next = crypto.randomUUID()
  await storage.set(EXTENSION_INSTALL_ID_KEY, next)
  return next
}

export async function buildAuthDevice(): Promise<AuthDevice> {
  return {
    anonymousDeviceId: await getOrCreateAnonymousDeviceId(),
    extensionInstallId: await getOrCreateExtensionInstallId(),
    label: "Chrome extension"
  }
}
