import type { ReactNode } from "react"
import { Folder } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import type { Sidebar } from "./use-sidebar"

function SidebarBody({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1" data-sidebar-body>
      <ScrollArea className="h-full">
        <div className="space-y-1 py-2 pr-2">{children}</div>
      </ScrollArea>
    </div>
  )
}

// Resizable aside on desktop; a Sheet overlay on mobile. `render` gets the
// callback to run after navigating to a file (closes the mobile sheet).
export function SidebarFrame({ sidebar, render }: {
  sidebar: Sidebar
  render: (onNavigate: () => void) => ReactNode
}) {
  return (
    <>
      {sidebar.open && (
        <>
          <aside className="hidden shrink-0 flex-col border-r border-border bg-card md:flex" style={{ width: sidebar.width }}>
            <SidebarBody>{render(() => {})}</SidebarBody>
          </aside>
          {/* Drag handle: resize sidebar (double-click resets width) */}
          <div
            onPointerDown={sidebar.startResize}
            onDoubleClick={sidebar.resetWidth}
            title="Drag to resize · double-click to reset"
            className={cn(
              "hidden w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-ring md:block",
              sidebar.isResizing && "bg-ring"
            )}
          />
        </>
      )}

      <Sheet open={sidebar.mobileOpen} onOpenChange={sidebar.setMobileOpen}>
        {/* Radix focuses the first input on open, which pops the mobile keyboard. */}
        <SheetContent side="left" className="w-80 gap-0 p-0 sm:max-w-xs" onOpenAutoFocus={e => e.preventDefault()}>
          <SheetHeader className="border-b border-border py-3">
            <SheetTitle className="flex items-center gap-2 text-sm">
              <Folder size={14} className="text-muted-foreground" />
              Files
            </SheetTitle>
            <SheetDescription className="sr-only">Browse repository files</SheetDescription>
          </SheetHeader>
          <SidebarBody>{render(() => sidebar.setMobileOpen(false))}</SidebarBody>
        </SheetContent>
      </Sheet>
    </>
  )
}
