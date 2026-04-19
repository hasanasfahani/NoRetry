"use client"

import Image from "next/image"
import type { CSSProperties } from "react"

type ReevaLogoProps = {
  width?: number
  height?: number
  priority?: boolean
  style?: CSSProperties
  imageStyle?: CSSProperties
}

export function ReevaLogo({
  width = 180,
  height = 46,
  priority = false,
  style,
  imageStyle
}: ReevaLogoProps) {
  return (
    <span
      style={{
        position: "relative",
        width,
        height,
        overflow: "hidden",
        display: "block",
        ...style
      }}
    >
      <Image
        src="/brand/reeva-logo.png"
        alt="reeva AI"
        fill
        priority={priority}
        sizes={`${Math.max(Number(width) || 180, 180)}px`}
        style={{
          objectFit: "cover",
          objectPosition: "center 49%",
          transform: "scale(1.2)",
          transformOrigin: "center center",
          display: "block",
          ...imageStyle
        }}
      />
    </span>
  )
}
