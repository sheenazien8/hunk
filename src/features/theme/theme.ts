import { useEffect, useSyncExternalStore } from "react"
import type { ThemeSetting } from "@/lib/settings/types"

// Must match the pre-hydration script in app/layout.tsx.
const THEME_STORAGE_KEY = "hunk-dark"
const DARK_QUERY = "(prefers-color-scheme: dark)"

// The .dark class on <html> is the source of truth for the theme. It is
// applied pre-hydration by the inline script in layout.tsx (localStorage,
// falling back to prefers-color-scheme). Reading it via useSyncExternalStore
// keeps state in sync with the DOM without a post-mount setState and without
// hydration mismatches.
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

function isThemeDark() {
  return document.documentElement.classList.contains("dark")
}

function isThemeDarkServer() {
  return false
}

function storedTheme(): ThemeSetting {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === null ? "system" : stored === "true" ? "dark" : "light"
  } catch {
    return "system"
  }
}

// Mirrors the theme into localStorage for the pre-hydration script.
export function applyTheme(mode: ThemeSetting) {
  try {
    if (mode === "system") localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, String(mode === "dark"))
  } catch {}
  const dark = mode === "system" ? window.matchMedia(DARK_QUERY).matches : mode === "dark"
  document.documentElement.classList.toggle("dark", dark)
}

export function useTheme() {
  const isDark = useSyncExternalStore(subscribeToTheme, isThemeDark, isThemeDarkServer)
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY)
    const onChange = () => {
      if (storedTheme() === "system") document.documentElement.classList.toggle("dark", media.matches)
    }
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])
  return { isDark }
}
