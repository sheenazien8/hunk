import type { Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Hunk",
  description: "Git diff viewer for reviewing code changes",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Hunk",
  },
  icons: {
    apple: "/apple-touch-icon.png",
    icon: [
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
  },
}

const themeScript = `
;(function () {
  try {
    // One-time move of pre-rebrand "git-review-*" keys (theme, tabs, sidebar, agent).
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var key = localStorage.key(i)
      if (!key || key.indexOf("git-review-") !== 0) continue
      var next = "hunk-" + key.slice("git-review-".length)
      if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key))
      localStorage.removeItem(key)
    }
    var stored = localStorage.getItem("hunk-dark")
    var dark = stored !== null ? stored === "true" : window.matchMedia("(prefers-color-scheme: dark)").matches
    if (dark) document.documentElement.classList.add("dark")
  } catch (e) {}
})()
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
