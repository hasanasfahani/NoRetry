export type PopupTone = "neutral" | "success" | "warning" | "danger" | "info"

export type PopupAction = {
  id: string
  label: string
  kind?: "primary" | "secondary" | "ghost"
  disabled?: boolean
  attention?: boolean
  onClick?: () => void
}
