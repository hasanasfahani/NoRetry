import type {
  AuthResponse,
  LoginAccountRequest,
  RefreshAccountRequest,
  RegisterAccountRequest
} from "@prompt-optimizer/shared"
import {
  buildDisplayName,
  buildSessionExpiry,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  isExpired,
  normalizeEmail,
  normalizeName,
  toAuthUser,
  verifyPassword
} from "./auth"
import {
  createAuthSession,
  createUser,
  findSessionByRefreshHash,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  revokeSession,
  touchSession,
  updateSessionTokens,
  upsertDevice
} from "./auth-repository"

function sessionPayload() {
  const accessToken = generateOpaqueToken()
  const refreshToken = generateOpaqueToken()
  const expiresAt = buildSessionExpiry()
  return {
    accessToken,
    refreshToken,
    expiresAt,
    sessionTokenHash: hashToken(accessToken),
    refreshTokenHash: hashToken(refreshToken)
  }
}

function buildAuthResponse(input: {
  user: {
    id: string
    email: string
    firstName: string
    lastName: string
    displayName: string | null
  }
  session: {
    accessToken: string
    refreshToken: string
    expiresAt: Date
  }
}): AuthResponse {
  return {
    user: toAuthUser(input.user),
    session: {
      accessToken: input.session.accessToken,
      refreshToken: input.session.refreshToken,
      expiresAt: input.session.expiresAt.toISOString()
    }
  }
}

export async function registerAccount(input: RegisterAccountRequest, userAgent?: string | null) {
  const email = normalizeEmail(input.email)
  const firstName = normalizeName(input.firstName)
  const lastName = normalizeName(input.lastName)

  const existing = await findUserByEmail(email)
  if (existing) {
    throw new Error("An account with that email already exists.")
  }

  const passwordHash = await hashPassword(input.password)
  const displayName = buildDisplayName(firstName, lastName)
  const user = await createUser({
    email,
    passwordHash,
    firstName,
    lastName,
    displayName
  })

  const sessionDraft = sessionPayload()
  await createAuthSession({
    userId: user.id,
    sessionTokenHash: sessionDraft.sessionTokenHash,
    refreshTokenHash: sessionDraft.refreshTokenHash,
    expiresAt: sessionDraft.expiresAt,
    deviceLabel: input.device?.label,
    userAgent: userAgent ?? undefined
  })

  if (input.device) {
    await upsertDevice({
      ...input.device,
      userId: user.id
    })
  }

  return buildAuthResponse({
    user,
    session: sessionDraft
  })
}

export async function loginAccount(input: LoginAccountRequest, userAgent?: string | null) {
  const email = normalizeEmail(input.email)
  const user = await findUserByEmail(email)
  if (!user || user.status !== "ACTIVE") {
    throw new Error("Invalid email or password.")
  }

  const verified = await verifyPassword(input.password, user.passwordHash)
  if (!verified) {
    throw new Error("Invalid email or password.")
  }

  const sessionDraft = sessionPayload()
  await createAuthSession({
    userId: user.id,
    sessionTokenHash: sessionDraft.sessionTokenHash,
    refreshTokenHash: sessionDraft.refreshTokenHash,
    expiresAt: sessionDraft.expiresAt,
    deviceLabel: input.device?.label,
    userAgent: userAgent ?? undefined
  })

  if (input.device) {
    await upsertDevice({
      ...input.device,
      userId: user.id
    })
  }

  return buildAuthResponse({
    user,
    session: sessionDraft
  })
}

export async function resolveAuthenticatedUser(accessToken: string) {
  if (!accessToken.trim()) {
    throw new Error("Missing access token.")
  }

  const session = await findSessionByTokenHash(hashToken(accessToken))
  if (!session || session.revokedAt || isExpired(session.expiresAt)) {
    throw new Error("Session expired. Please sign in again.")
  }

  const user = await findUserById(session.userId)
  if (!user || user.status !== "ACTIVE") {
    throw new Error("Account is unavailable.")
  }

  await touchSession(session.id)
  return {
    user: toAuthUser(user),
    sessionId: session.id
  }
}

export async function refreshAccountSession(input: RefreshAccountRequest) {
  const token = input.refreshToken.trim()
  if (!token) {
    throw new Error("Missing refresh token.")
  }

  const session = await findSessionByRefreshHash(hashToken(token))
  if (!session || session.revokedAt || isExpired(session.expiresAt)) {
    throw new Error("Refresh session expired. Please sign in again.")
  }

  const user = await findUserById(session.userId)
  if (!user || user.status !== "ACTIVE") {
    throw new Error("Account is unavailable.")
  }

  const sessionDraft = sessionPayload()
  await updateSessionTokens({
    sessionId: session.id,
    sessionTokenHash: sessionDraft.sessionTokenHash,
    refreshTokenHash: sessionDraft.refreshTokenHash,
    expiresAt: sessionDraft.expiresAt
  })

  if (input.device) {
    await upsertDevice({
      ...input.device,
      userId: user.id
    })
  }

  return buildAuthResponse({
    user,
    session: sessionDraft
  })
}

export async function logoutAccount(accessToken: string) {
  if (!accessToken.trim()) return { success: true }

  const session = await findSessionByTokenHash(hashToken(accessToken))
  if (!session) return { success: true }
  await revokeSession(session.id)
  return { success: true }
}
