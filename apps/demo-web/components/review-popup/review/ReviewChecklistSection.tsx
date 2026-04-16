import type { CSSProperties } from "react"
import { CollapsibleSection } from "../shared/CollapsibleSection"
import type { ReviewChecklistItem } from "./review-types"

type ReviewChecklistSectionProps = {
  items: ReviewChecklistItem[]
}

export function ReviewChecklistSection(props: ReviewChecklistSectionProps) {
  return (
    <CollapsibleSection title="Checklist">
      <ul style={styles.list}>
        {props.items.map((item) => (
          <li key={item.id} style={styles.row}>
            <span style={styles.label}>{item.label}</span>
            <span style={styles.marker(item.status)}>{statusLabel(item.status)}</span>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  )
}

function statusLabel(status: ReviewChecklistItem["status"]) {
  switch (status) {
    case "verified":
      return "Confirmed"
    case "missing":
      return "Missing"
    case "blocked":
      return "Not proven"
    default:
      return "Not proven"
  }
}

const styles = {
  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "grid",
    gap: 10
  } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12
  } satisfies CSSProperties,
  label: {
    fontSize: 14,
    lineHeight: 1.5,
    color: "#1e293b"
  } satisfies CSSProperties,
  marker: (status: ReviewChecklistItem["status"]) =>
    ({
      flexShrink: 0,
      borderRadius: 999,
      padding: "6px 10px",
      fontSize: 12,
      fontWeight: 800,
      background:
        status === "verified"
          ? "#dcfce7"
          : status === "missing"
            ? "#fee2e2"
            : status === "blocked"
              ? "#fef3c7"
              : "#e2e8f0",
      color:
        status === "verified"
          ? "#166534"
          : status === "missing"
            ? "#b91c1c"
            : status === "blocked"
              ? "#b45309"
              : "#475569"
    }) satisfies CSSProperties
}
