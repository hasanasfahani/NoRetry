import type { CSSProperties } from "react"
import { SectionCard } from "../shared/SectionCard"

type ReviewMissingItemsProps = {
  items: string[]
}

export function ReviewMissingItems(props: ReviewMissingItemsProps) {
  if (!props.items.length) return null

  return (
    <SectionCard title="Missing / unverified">
      <ul style={styles.list}>
        {props.items.map((item) => (
          <li key={item} style={styles.item}>
            {item}
          </li>
        ))}
      </ul>
    </SectionCard>
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
    color: "#0f172a",
    fontSize: 15,
    lineHeight: 1.55
  }
}
