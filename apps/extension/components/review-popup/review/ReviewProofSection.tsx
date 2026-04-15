import type { CSSProperties } from "react"
import { CollapsibleSection } from "../shared/CollapsibleSection"

type ReviewProofSectionProps = {
  summary: string
  checked: string[]
  missing: string[]
}

export function ReviewProofSection(props: ReviewProofSectionProps) {
  return (
    <CollapsibleSection title="Proof details">
      {props.summary ? <p style={styles.summary}>{props.summary}</p> : null}
      <div style={styles.group}>
        <p style={styles.label}>Checked</p>
        <ul style={styles.list}>
          {props.checked.map((item) => (
            <li key={item} style={styles.item}>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div style={styles.group}>
        <p style={styles.label}>Not checked</p>
        <ul style={styles.list}>
          {props.missing.map((item) => (
            <li key={item} style={styles.item}>
              {item}
            </li>
          ))}
        </ul>
      </div>
    </CollapsibleSection>
  )
}

const styles: Record<string, CSSProperties> = {
  summary: {
    margin: 0,
    color: "#475569",
    fontSize: 14,
    lineHeight: 1.55
  },
  group: {
    display: "grid",
    gap: 8
  },
  label: {
    margin: 0,
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#64748b"
  },
  list: {
    margin: 0,
    paddingLeft: 18,
    display: "grid",
    gap: 8
  },
  item: {
    color: "#334155",
    fontSize: 14,
    lineHeight: 1.55
  }
}
