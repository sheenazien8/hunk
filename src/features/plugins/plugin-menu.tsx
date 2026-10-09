import { Puzzle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { PluginInfo } from "@/lib/plugins/types"

export function PluginMenu({ plugins, onOpen }: { plugins: PluginInfo[]; onOpen: (id: string) => void }) {
  if (plugins.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Plugins" title="Plugins">
          <Puzzle size={16} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {plugins.map(p => (
          <DropdownMenuItem key={p.id} onSelect={() => onOpen(p.id)}>
            <Puzzle size={14} />
            {p.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
