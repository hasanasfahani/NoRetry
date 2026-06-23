import "./globals.css"
import type { Metadata } from "next"
import type { ReactNode } from "react"

export const metadata: Metadata = {
  title: "reeva AI | Build apps on Replit without the chaos",
  description:
    "reeva AI helps non-technical builders plan, prompt, review, repair, and test software built with AI agents on Replit."
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
