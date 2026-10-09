"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { LogOut, Moon, Settings, Sun } from "lucide-react"
import { usePopover } from "@/hooks/use-popover"

const itemCls = "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent focus:bg-accent focus:outline-none"

// Header avatar menu: signed-in username, theme toggle and Logout. Until
// /api/auth/me answers (or without auth) it's a settings icon with the theme only.
export function AccountMenu({ isDark, onToggleTheme }: { isDark: boolean; onToggleTheme: () => void }) {
  const router = useRouter()
  const { open, setOpen, rootRef, triggerRef } = usePopover()
  const [username, setUsername] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/me")
      .then(res => (res.ok ? res.json() : null))
      .then(data => setUsername(data?.username ?? null))
      .catch(() => setUsername(null))
  }, [])

  async function logout() {
    setOpen(false)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } finally {
      router.push("/login")
      router.refresh()
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={username ? `Account: ${username}` : "Settings"}
        title={username ?? "Settings"}
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-secondary text-sm font-semibold uppercase text-secondary-foreground hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
      >
        {username ? username.charAt(0) : <Settings size={15} />}
      </button>

      {open && (
        <div role="menu" className="absolute right-0 top-full z-50 mt-1 w-56 max-w-[calc(100vw-1.5rem)] rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {username && (
            <>
              <div className="px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Signed in as</div>
                <div className="truncate text-sm font-medium">{username}</div>
              </div>
              <div className="my-1 h-px bg-border" />
            </>
          )}
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={onToggleTheme}
            className={itemCls}
          >
            {isDark ? <Sun size={12} /> : <Moon size={12} />}
            {isDark ? "Light theme" : "Dark theme"}
          </button>
          {username && (
            <button type="button" role="menuitem" onClick={() => void logout()} className={itemCls}>
              <LogOut size={12} />
              Logout
            </button>
          )}
        </div>
      )}
    </div>
  )
}
