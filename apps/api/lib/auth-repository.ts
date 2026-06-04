import { runtimeFlags } from "./env"
import { prisma } from "./prisma"

type UserRecord = {
  id: string
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  displayName: string | null
  emailVerifiedAt: string | null
  status: "ACTIVE" | "DISABLED"
  createdAt: string
  updatedAt: string
}

type AuthSessionRecord = {
  id: string
  userId: string
  sessionTokenHash: string
  refreshTokenHash: string
  deviceLabel: string | null
  userAgent: string | null
  expiresAt: string
  revokedAt: string | null
  lastSeenAt: string
  createdAt: string
}

type DeviceRecord = {
  id: string
  userId: string | null
  anonymousDeviceId: string
  extensionInstallId: string
  label: string | null
  lastSeenAt: string
  createdAt: string
}

const memoryStore = {
  usersById: new Map<string, UserRecord>(),
  usersByEmail: new Map<string, UserRecord>(),
  sessionsById: new Map<string, AuthSessionRecord>(),
  sessionsByTokenHash: new Map<string, AuthSessionRecord>(),
  sessionsByRefreshHash: new Map<string, AuthSessionRecord>(),
  devicesByComposite: new Map<string, DeviceRecord>()
}

function nowIso() {
  return new Date().toISOString()
}

function deviceCompositeKey(input: { anonymousDeviceId: string; extensionInstallId: string }) {
  return `${input.anonymousDeviceId}::${input.extensionInstallId}`
}

export async function findUserByEmail(email: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.usersByEmail.get(email) ?? null
  }

  return prisma.user.findUnique({
    where: { email }
  })
}

export async function findUserById(id: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.usersById.get(id) ?? null
  }

  return prisma.user.findUnique({
    where: { id }
  })
}

export async function createUser(input: {
  email: string
  passwordHash: string
  firstName: string
  lastName: string
  displayName: string
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const record: UserRecord = {
      id: crypto.randomUUID(),
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      displayName: input.displayName,
      emailVerifiedAt: null,
      status: "ACTIVE",
      createdAt: nowIso(),
      updatedAt: nowIso()
    }
    memoryStore.usersById.set(record.id, record)
    memoryStore.usersByEmail.set(record.email, record)
    return record
  }

  return prisma.user.create({
    data: input
  })
}

export async function upsertDevice(input: {
  anonymousDeviceId: string
  extensionInstallId: string
  label?: string
  userId?: string | null
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const key = deviceCompositeKey(input)
    const existing = memoryStore.devicesByComposite.get(key)
    const record: DeviceRecord = existing
      ? {
          ...existing,
          userId: input.userId ?? existing.userId,
          label: input.label ?? existing.label,
          lastSeenAt: nowIso()
        }
      : {
          id: crypto.randomUUID(),
          anonymousDeviceId: input.anonymousDeviceId,
          extensionInstallId: input.extensionInstallId,
          label: input.label ?? null,
          userId: input.userId ?? null,
          lastSeenAt: nowIso(),
          createdAt: nowIso()
        }
    memoryStore.devicesByComposite.set(key, record)
    return record
  }

  return prisma.device.upsert({
    where: {
      anonymousDeviceId_extensionInstallId: {
        anonymousDeviceId: input.anonymousDeviceId,
        extensionInstallId: input.extensionInstallId
      }
    },
    create: {
      anonymousDeviceId: input.anonymousDeviceId,
      extensionInstallId: input.extensionInstallId,
      label: input.label ?? null,
      userId: input.userId ?? null
    },
    update: {
      label: input.label ?? undefined,
      userId: input.userId ?? undefined,
      lastSeenAt: new Date()
    }
  })
}

export async function createAuthSession(input: {
  userId: string
  sessionTokenHash: string
  refreshTokenHash: string
  expiresAt: Date
  deviceLabel?: string
  userAgent?: string
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const record: AuthSessionRecord = {
      id: crypto.randomUUID(),
      userId: input.userId,
      sessionTokenHash: input.sessionTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      deviceLabel: input.deviceLabel ?? null,
      userAgent: input.userAgent ?? null,
      expiresAt: input.expiresAt.toISOString(),
      revokedAt: null,
      lastSeenAt: nowIso(),
      createdAt: nowIso()
    }
    memoryStore.sessionsById.set(record.id, record)
    memoryStore.sessionsByTokenHash.set(record.sessionTokenHash, record)
    memoryStore.sessionsByRefreshHash.set(record.refreshTokenHash, record)
    return record
  }

  return prisma.authSession.create({
    data: {
      userId: input.userId,
      sessionTokenHash: input.sessionTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      deviceLabel: input.deviceLabel ?? null,
      userAgent: input.userAgent ?? null
    }
  })
}

export async function findSessionByTokenHash(sessionTokenHash: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.sessionsByTokenHash.get(sessionTokenHash) ?? null
  }

  return prisma.authSession.findUnique({
    where: { sessionTokenHash }
  })
}

export async function findSessionByRefreshHash(refreshTokenHash: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    return memoryStore.sessionsByRefreshHash.get(refreshTokenHash) ?? null
  }

  return prisma.authSession.findUnique({
    where: { refreshTokenHash }
  })
}

export async function updateSessionTokens(input: {
  sessionId: string
  sessionTokenHash: string
  refreshTokenHash: string
  expiresAt: Date
}) {
  if (!runtimeFlags.enableDb || !prisma) {
    const current = memoryStore.sessionsById.get(input.sessionId)
    if (!current) return null
    memoryStore.sessionsByTokenHash.delete(current.sessionTokenHash)
    memoryStore.sessionsByRefreshHash.delete(current.refreshTokenHash)
    const next: AuthSessionRecord = {
      ...current,
      sessionTokenHash: input.sessionTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt.toISOString(),
      lastSeenAt: nowIso()
    }
    memoryStore.sessionsById.set(next.id, next)
    memoryStore.sessionsByTokenHash.set(next.sessionTokenHash, next)
    memoryStore.sessionsByRefreshHash.set(next.refreshTokenHash, next)
    return next
  }

  return prisma.authSession.update({
    where: { id: input.sessionId },
    data: {
      sessionTokenHash: input.sessionTokenHash,
      refreshTokenHash: input.refreshTokenHash,
      expiresAt: input.expiresAt,
      lastSeenAt: new Date(),
      revokedAt: null
    }
  })
}

export async function touchSession(sessionId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    const current = memoryStore.sessionsById.get(sessionId)
    if (!current) return null
    const next = { ...current, lastSeenAt: nowIso() }
    memoryStore.sessionsById.set(next.id, next)
    memoryStore.sessionsByTokenHash.set(next.sessionTokenHash, next)
    memoryStore.sessionsByRefreshHash.set(next.refreshTokenHash, next)
    return next
  }

  return prisma.authSession.update({
    where: { id: sessionId },
    data: {
      lastSeenAt: new Date()
    }
  })
}

export async function revokeSession(sessionId: string) {
  if (!runtimeFlags.enableDb || !prisma) {
    const current = memoryStore.sessionsById.get(sessionId)
    if (!current) return null
    const next = { ...current, revokedAt: nowIso() }
    memoryStore.sessionsById.set(next.id, next)
    memoryStore.sessionsByTokenHash.set(next.sessionTokenHash, next)
    memoryStore.sessionsByRefreshHash.set(next.refreshTokenHash, next)
    return next
  }

  return prisma.authSession.update({
    where: { id: sessionId },
    data: {
      revokedAt: new Date()
    }
  })
}
