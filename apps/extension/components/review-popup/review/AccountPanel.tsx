import { useMemo, useState, type CSSProperties, type FormEvent } from "react"
import type { AccountState } from "../../../lib/account/account-types"

type AccountPanelProps = {
  accountState: AccountState
  isSubmitting: boolean
  onLogin: (input: { email: string; password: string }) => Promise<void> | void
  onRegister: (input: { firstName: string; lastName: string; email: string; password: string }) => Promise<void> | void
  onLogout: () => Promise<void> | void
}

type AuthMode = "login" | "register"

export function AccountPanel(props: AccountPanelProps) {
  const [mode, setMode] = useState<AuthMode>("login")
  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)

  const helperCopy = useMemo(
    () =>
      props.accountState.status === "authenticated"
        ? "Your extension is signed in. Guest mode still works on other devices until you sign in there too."
        : "You can keep using reeva AI as a guest. Create an account when you want your extension identity ready for cloud sync.",
    [props.accountState.status]
  )

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLocalError(null)

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password.trim()) {
      setLocalError("Email and password are required.")
      return
    }

    if (mode === "register") {
      if (!firstName.trim() || !lastName.trim()) {
        setLocalError("First name and last name are required.")
        return
      }

      await props.onRegister({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: trimmedEmail,
        password
      })
      return
    }

    await props.onLogin({
      email: trimmedEmail,
      password
    })
  }

  if (props.accountState.status === "authenticated" && props.accountState.user) {
    return (
      <div style={styles.layout}>
        <section style={styles.heroCard}>
          <p style={styles.headline}>Account connected</p>
          <p style={styles.body}>
            Signed in as <strong>{props.accountState.user.displayName}</strong>.
          </p>
          <p style={styles.muted}>{props.accountState.user.email}</p>
          <p style={styles.helper}>{helperCopy}</p>
          <div style={styles.accountMetaGrid}>
            <div style={styles.metaCard}>
              <p style={styles.metaLabel}>First name</p>
              <p style={styles.metaValue}>{props.accountState.user.firstName}</p>
            </div>
            <div style={styles.metaCard}>
              <p style={styles.metaLabel}>Last name</p>
              <p style={styles.metaValue}>{props.accountState.user.lastName}</p>
            </div>
          </div>
          {props.accountState.session ? (
            <p style={styles.sessionHint}>
              Session active until {new Date(props.accountState.session.expiresAt).toLocaleString()}.
            </p>
          ) : null}
          <div style={styles.actionRow}>
            <button
              type="button"
              style={styles.primaryButton}
              onClick={() => void props.onLogout()}
              disabled={props.isSubmitting}
            >
              {props.isSubmitting ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div style={styles.layout}>
      <section style={styles.heroCard}>
        <div style={styles.modeTabs}>
          <button type="button" style={styles.modeTab(mode === "login")} onClick={() => setMode("login")}>
            Sign in
          </button>
          <button type="button" style={styles.modeTab(mode === "register")} onClick={() => setMode("register")}>
            Create account
          </button>
        </div>
        <p style={styles.headline}>{mode === "login" ? "Sign in to reeva AI" : "Create your reeva AI account"}</p>
        <p style={styles.helper}>{helperCopy}</p>
        <form style={styles.form} onSubmit={(event) => void handleSubmit(event)}>
          {mode === "register" ? (
            <div style={styles.nameRow}>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>First name</span>
                <input
                  style={styles.input}
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  autoComplete="given-name"
                  disabled={props.isSubmitting}
                />
              </label>
              <label style={styles.field}>
                <span style={styles.fieldLabel}>Last name</span>
                <input
                  style={styles.input}
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  autoComplete="family-name"
                  disabled={props.isSubmitting}
                />
              </label>
            </div>
          ) : null}
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Email</span>
            <input
              type="email"
              style={styles.input}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              disabled={props.isSubmitting}
            />
          </label>
          <label style={styles.field}>
            <span style={styles.fieldLabel}>Password</span>
            <input
              type="password"
              style={styles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              disabled={props.isSubmitting}
            />
          </label>
          {localError || props.accountState.errorMessage ? (
            <p style={styles.errorText}>{localError || props.accountState.errorMessage}</p>
          ) : null}
          <div style={styles.actionRow}>
            <button type="submit" style={styles.primaryButton} disabled={props.isSubmitting}>
              {props.isSubmitting
                ? mode === "login"
                  ? "Signing in..."
                  : "Creating account..."
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

const styles = {
  layout: {
    display: "grid",
    gap: 14
  },
  heroCard: {
    display: "grid",
    gap: 16,
    padding: 18,
    borderRadius: 24,
    border: "1px solid rgba(191,219,254,0.9)",
    background: "linear-gradient(180deg, rgba(239,246,255,0.92), rgba(255,255,255,0.98))"
  },
  modeTabs: {
    display: "inline-flex",
    gap: 8
  },
  modeTab: (active: boolean) =>
    ({
      border: active ? "1px solid rgba(59,130,246,0.28)" : "1px solid rgba(148,163,184,0.2)",
      background: active ? "rgba(219,234,254,0.96)" : "#ffffff",
      color: active ? "#1d4ed8" : "#475569",
      padding: "10px 14px",
      borderRadius: 999,
      fontSize: 13,
      fontWeight: 700,
      cursor: "pointer"
    }) satisfies CSSProperties,
  headline: {
    margin: 0,
    fontSize: 17,
    lineHeight: 1.25,
    color: "#0f172a",
    fontWeight: 800
  },
  body: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.55,
    color: "#334155"
  },
  muted: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#64748b",
    fontWeight: 700
  },
  helper: {
    margin: 0,
    fontSize: 14,
    lineHeight: 1.6,
    color: "#475569"
  },
  form: {
    display: "grid",
    gap: 14
  },
  nameRow: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "1fr 1fr"
  },
  field: {
    display: "grid",
    gap: 8
  },
  fieldLabel: {
    fontSize: 12,
    lineHeight: 1.2,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700
  },
  input: {
    width: "100%",
    borderRadius: 16,
    border: "1px solid rgba(148,163,184,0.24)",
    background: "#ffffff",
    color: "#0f172a",
    padding: "12px 14px",
    fontSize: 14,
    lineHeight: 1.4,
    outline: "none"
  },
  errorText: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "#b91c1c",
    fontWeight: 700
  },
  actionRow: {
    display: "flex",
    justifyContent: "flex-start"
  },
  primaryButton: {
    border: "1px solid rgba(37,99,235,0.18)",
    background: "linear-gradient(135deg, #0766fe 0%, #3b82f6 100%)",
    color: "#ffffff",
    borderRadius: 18,
    padding: "12px 18px",
    fontSize: 14,
    fontWeight: 800,
    cursor: "pointer",
    boxShadow: "0 14px 30px rgba(37,99,235,0.18)"
  },
  accountMetaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12
  },
  metaCard: {
    display: "grid",
    gap: 6,
    padding: 14,
    borderRadius: 18,
    background: "rgba(255,255,255,0.84)",
    border: "1px solid rgba(226,232,240,0.9)"
  },
  metaLabel: {
    margin: 0,
    fontSize: 11,
    lineHeight: 1.2,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "#64748b",
    fontWeight: 700
  },
  metaValue: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.4,
    color: "#0f172a",
    fontWeight: 700
  },
  sessionHint: {
    margin: 0,
    fontSize: 12,
    lineHeight: 1.5,
    color: "#64748b"
  }
} satisfies Record<string, CSSProperties | ((active: boolean) => CSSProperties)>
