import type { AuthSession, AuthUser } from "@prompt-optimizer/shared"

export type AccountStatus = "loading" | "guest" | "authenticated"

export type AccountState = {
  status: AccountStatus
  user: AuthUser | null
  session: AuthSession | null
  errorMessage: string | null
}

export function createGuestAccountState(): AccountState {
  return {
    status: "guest",
    user: null,
    session: null,
    errorMessage: null
  }
}
