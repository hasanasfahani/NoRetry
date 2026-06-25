import "./globals.css"
import type { Metadata } from "next"
import { PT_Sans } from "next/font/google"
import type { ReactNode } from "react"

const ptSans = PT_Sans({
  weight: ["400", "700"],
  subsets: ["latin"],
  variable: "--font-pt-sans",
  display: "swap"
})

export const metadata: Metadata = {
  title: "reeva AI | Build better Replit apps without losing control",
  description:
    "reeva AI helps non-technical builders plan smarter prompts, review AI output, repair gaps, and test before moving forward."
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={ptSans.variable}>
      <body>{children}</body>
    </html>
  )
}
