import type { CSSProperties } from "react"
import { CollapsibleSection } from "../shared/CollapsibleSection"

type ReviewWhySectionProps = {
  items: string[]
}

export function ReviewWhySection(props: ReviewWhySectionProps) {
  return (
    <CollapsibleSection title="Why this decision">
      <ul style={styles.list}>
        {props.items.map((item) => (
          <li key={item} style={styles.item}>
            {item}
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  )
}

const styles: Record<string, CSSProperties> = {
  list: {
    margin: 0,
    paddingLeft: 18,
    display: "grid",
    gap: 8
  },
  item: {
    fontSize: 15,
    lineHeight: 1.55,
    color: "#334155"
  }
}
