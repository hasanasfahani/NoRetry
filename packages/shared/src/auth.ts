import * as z from "zod"

export const AuthUserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string()
})

export const AuthSessionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.string()
})

export const AuthDeviceSchema = z.object({
  anonymousDeviceId: z.string(),
  extensionInstallId: z.string(),
  label: z.string().optional()
})

export const RegisterAccountRequestSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
  device: AuthDeviceSchema.optional()
})

export const LoginAccountRequestSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128),
  device: AuthDeviceSchema.optional()
})

export const RefreshAccountRequestSchema = z.object({
  refreshToken: z.string(),
  device: AuthDeviceSchema.optional()
})

export const LogoutAccountRequestSchema = z.object({
  accessToken: z.string().optional()
})

export const AuthResponseSchema = z.object({
  user: AuthUserSchema,
  session: AuthSessionSchema
})

export const AuthMeResponseSchema = z.object({
  user: AuthUserSchema
})

export type AuthUser = z.infer<typeof AuthUserSchema>
export type AuthSession = z.infer<typeof AuthSessionSchema>
export type AuthDevice = z.infer<typeof AuthDeviceSchema>
export type RegisterAccountRequest = z.infer<typeof RegisterAccountRequestSchema>
export type LoginAccountRequest = z.infer<typeof LoginAccountRequestSchema>
export type RefreshAccountRequest = z.infer<typeof RefreshAccountRequestSchema>
export type LogoutAccountRequest = z.infer<typeof LogoutAccountRequestSchema>
export type AuthResponse = z.infer<typeof AuthResponseSchema>
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>
