import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { CaseSensitive, ChevronRight, ListFilter, Loader2, Regex, TextSearch, WholeWord } from "lucide-react"
import type { SearchFileResult, SearchMatch } from "@/lib/git/types"
import { cn } from "@/lib/utils"
import type { Search, SearchForm } from "./use-search"

const NONE: ReadonlySet<string> = new Set()

type Row =
  | { kind: "file"; file: SearchFileResult; collapsed: boolean }
  | { kind: "match"; path: string; match: SearchMatch; index: number }

// Ctrl/Cmd+Shift+F "Search in files": a text search over the repo, results
// grouped by file. ↑/↓ pick a match, Enter opens the file at that line.
export function SearchDialog({ search, onOpen }: { search: Search; onOpen: (path: string, line: number) => void }) {
  return (
    <DialogPrimitive.Root open={search.open} onOpenChange={search.setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">Search in files</DialogPrimitive.Title>
          <SearchBody search={search} onOpen={(path, line) => {
            search.setOpen(false)
            onOpen(path, line)
          }} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function SearchBody({ search, onOpen }: { search: Search; onOpen: (path: string, line: number) => void }) {
  const { form, update, data, error, loading, stale } = search
  // Collapsed files and the selection reset whenever new results arrive.
  const [collapsedFor, setCollapsedFor] = useState<{ paths: ReadonlySet<string>; forData: typeof data }>({ paths: new Set(), forData: data })
  const collapsed = collapsedFor.forData === data ? collapsedFor.paths : NONE
  const [{ selected, forData }, setSelection] = useState({ selected: 0, forData: data })
  const listRef = useRef<HTMLDivElement>(null)

  const { rows, matches } = useMemo(() => {
    const rows: Row[] = []
    const matches: Extract<Row, { kind: "match" }>[] = []
    for (const file of data?.files ?? []) {
      const isCollapsed = collapsed.has(file.path)
      rows.push({ kind: "file", file, collapsed: isCollapsed })
      if (isCollapsed) continue
      for (const match of file.matches) {
        const row = { kind: "match" as const, path: file.path, match, index: matches.length }
        rows.push(row)
        matches.push(row)
      }
    }
    return { rows, matches }
  }, [data, collapsed])

  const index = forData === data ? Math.min(selected, Math.max(matches.length - 1, 0)) : 0
  const select = (i: number) => setSelection({ selected: i, forData: data })

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" })
  }, [index])

  const toggleFile = (path: string) => {
    const paths = new Set(collapsed)
    if (!paths.delete(path)) paths.add(path)
    setCollapsedFor({ paths, forData: data })
  }

  const move = (delta: number) => {
    if (matches.length === 0) return
    select((index + delta + matches.length) % matches.length)
  }

  const choose = (row: Extract<Row, { kind: "match" }> | undefined) => {
    if (row) onOpen(row.path, row.match.line)
  }

  // Keys shared by every field of the form: result navigation and the
  // VS Code toggles (Alt+C / Alt+W / Alt+R).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const ctrl = e.ctrlKey || e.metaKey
    const key = e.key.toLowerCase()
    if (e.key === "ArrowDown" || (ctrl && key === "n")) move(1)
    else if (e.key === "ArrowUp" || (ctrl && key === "p")) move(-1)
    else if (e.key === "PageDown") move(10)
    else if (e.key === "PageUp") move(-10)
    else if (e.key === "Enter") choose(matches[index])
    else if (e.altKey && e.code === "KeyC") update({ caseSensitive: !form.caseSensitive })
    else if (e.altKey && e.code === "KeyW") update({ wholeWord: !form.wholeWord })
    else if (e.altKey && e.code === "KeyR") update({ regex: !form.regex })
    else {
      // Keep app shortcuts (Ctrl+W, Ctrl+Tab, …) from firing behind the dialog.
      if (ctrl) e.stopPropagation()
      return
    }
    e.preventDefault()
    e.stopPropagation()
  }

  const fileCount = data?.files.length ?? 0
  const summary = !form.query
    ? "Type to search file contents"
    : error
      ? null
      : data
        ? data.total === 0
          ? "No results"
          : `${data.total}${data.truncated ? "+" : ""} ${data.total === 1 ? "result" : "results"} in ${fileCount} ${fileCount === 1 ? "file" : "files"}${data.truncated ? " (showing the first ones; refine the search)" : ""}`
        : "Searching…"

  return (
    <>
      <div className="flex items-center gap-1 border-b border-border px-3">
        <TextSearch size={14} className="mr-1 shrink-0 text-muted-foreground" />
        <input
          autoFocus
          onFocus={e => e.currentTarget.select()}
          value={form.query}
          onChange={e => update({ query: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder="Search in files"
          role="combobox"
          aria-expanded
          aria-controls="search-results"
          aria-activedescendant={matches.length > 0 ? `search-result-${index}` : undefined}
          spellCheck={false}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        {loading && <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" aria-label="Searching" />}
        <Toggle on={form.caseSensitive} title="Match case (Alt+C)" onClick={() => update({ caseSensitive: !form.caseSensitive })}><CaseSensitive size={16} /></Toggle>
        <Toggle on={form.wholeWord} title="Match whole word (Alt+W)" onClick={() => update({ wholeWord: !form.wholeWord })}><WholeWord size={16} /></Toggle>
        <Toggle on={form.regex} title="Use regular expression (Alt+R)" onClick={() => update({ regex: !form.regex })}><Regex size={16} /></Toggle>
        <Toggle on={form.showFilters || !!form.include || !!form.exclude} title="Files to include / exclude" onClick={() => update({ showFilters: !form.showFilters })}><ListFilter size={16} /></Toggle>
      </div>
      {form.showFilters && (
        <div className="flex flex-col gap-1.5 border-b border-border px-3 py-2 sm:flex-row">
          <FilterInput label="Files to include" placeholder="e.g. *.ts, src/" value={form.include} field="include" update={update} onKeyDown={onKeyDown} />
          <FilterInput label="Files to exclude" placeholder="e.g. *.test.ts, docs" value={form.exclude} field="exclude" update={update} onKeyDown={onKeyDown} />
        </div>
      )}
      <p className={cn("px-3 py-1.5 text-[11px]", error ? "text-destructive" : "text-muted-foreground")}>{error || summary}</p>
      <div
        ref={listRef}
        id="search-results"
        role="listbox"
        className={cn("min-h-0 flex-1 overflow-y-auto pb-1 transition-opacity", stale && "opacity-60")}
      >
        {rows.map(row => row.kind === "file" ? (
          <FileRow key={`f:${row.file.path}`} file={row.file} collapsed={row.collapsed} onToggle={() => toggleFile(row.file.path)} />
        ) : (
          <MatchRow
            key={`m:${row.path}:${row.match.line}`}
            match={row.match}
            index={row.index}
            selected={row.index === index}
            onHover={() => row.index !== index && select(row.index)}
            onChoose={() => choose(row)}
          />
        ))}
      </div>
    </>
  )
}

function Toggle({ on, title, onClick, children }: { on: boolean; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={on}
      // Keep focus in the query field.
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
        on ? "bg-primary/15 text-primary ring-1 ring-primary/40" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function FilterInput({ label, placeholder, value, field, update, onKeyDown }: {
  label: string
  placeholder: string
  value: string
  field: "include" | "exclude"
  update: (patch: Partial<SearchForm>) => void
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[11px] text-muted-foreground">
      {label}
      <input
        value={value}
        onChange={e => update({ [field]: e.target.value })}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="h-7 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  )
}

function FileRow({ file, collapsed, onToggle }: { file: SearchFileResult; collapsed: boolean; onToggle: () => void }) {
  const nameStart = file.path.lastIndexOf("/") + 1
  return (
    <button
      type="button"
      onMouseDown={e => e.preventDefault()}
      onClick={onToggle}
      aria-expanded={!collapsed}
      className="sticky top-0 z-10 flex w-full items-center gap-1.5 bg-popover px-2 py-1 text-left text-sm hover:bg-accent"
      title={file.path}
    >
      <ChevronRight size={14} className={cn("shrink-0 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
      <span className="shrink-0 font-medium">{file.path.slice(nameStart)}</span>
      {nameStart > 0 && <span className="min-w-0 truncate text-xs text-muted-foreground">{file.path.slice(0, nameStart - 1)}</span>}
      <span className="ml-auto shrink-0 rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">{file.matches.length}</span>
    </button>
  )
}

function MatchRow({ match, index, selected, onHover, onChoose }: {
  match: SearchMatch
  index: number
  selected: boolean
  onHover: () => void
  onChoose: () => void
}) {
  return (
    <div
      id={`search-result-${index}`}
      data-index={index}
      role="option"
      aria-selected={selected}
      onMouseMove={onHover}
      onMouseDown={e => e.preventDefault()}
      onClick={onChoose}
      className={cn(
        "flex cursor-pointer items-baseline gap-2 py-0.5 pl-8 pr-3 font-mono text-xs",
        selected ? "bg-accent text-accent-foreground" : "text-foreground"
      )}
    >
      <span className="w-10 shrink-0 text-right text-[10px] text-muted-foreground">{match.line}</span>
      <span className="min-w-0 truncate whitespace-pre">
        <Highlighted text={match.text} ranges={match.ranges} />
      </span>
    </div>
  )
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start < at) continue
    if (start > at) parts.push(text.slice(at, start))
    parts.push(<mark key={start} className="rounded-[2px] bg-primary/20 font-semibold text-foreground">{text.slice(start, end)}</mark>)
    at = end
  }
  parts.push(text.slice(at))
  return parts
}
