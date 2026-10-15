import { useCallback, useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import type { SearchOptions, SearchResponse } from "@/lib/git/types"

const DEBOUNCE_MS = 250
// A selection longer than this isn't taken as the query.
const MAX_PREFILL = 200

export interface SearchForm extends Required<SearchOptions> {
  showFilters: boolean
}

const EMPTY: SearchForm = { query: "", caseSensitive: false, wholeWord: false, regex: false, include: "", exclude: "", showFilters: false }

type Result = { key: string; repo: string; data?: SearchResponse; error?: string }

// Ctrl/Cmd+Shift+F "Search in files". The form and last results live here,
// not in the dialog, so reopening it shows the previous search. Each change
// re-runs the search (debounced, the older request aborted), and so does
// every reopen, since files may have changed in between.
export function useSearch(repoPath: string) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<SearchForm>(EMPTY)
  const [run, setRun] = useState(0)
  const [result, setResult] = useState<Result | null>(null)

  const { query, caseSensitive, wholeWord, regex, include, exclude } = form
  const opts: SearchOptions = { query, caseSensitive, wholeWord, regex, include, exclude }
  const key = JSON.stringify([repoPath, opts, run])

  useEffect(() => {
    if (!open || !opts.query) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => {
      api.search(repoPath, opts, ctrl.signal).then(
        data => setResult({ key, repo: repoPath, data }),
        e => {
          if (!ctrl.signal.aborted) setResult({ key, repo: repoPath, error: e instanceof Error ? e.message : "Search failed" })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
    // `key` covers repoPath and every option.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key])

  // Opens the dialog; a one-line text selection becomes the query, like VS Code.
  const show = useCallback(() => {
    const selected = typeof window === "undefined" ? "" : window.getSelection()?.toString().trim() ?? ""
    if (selected && !selected.includes("\n") && selected.length <= MAX_PREFILL) setForm(f => ({ ...f, query: selected }))
    setRun(n => n + 1)
    setOpen(true)
  }, [])

  const update = useCallback((patch: Partial<SearchForm>) => setForm(f => ({ ...f, ...patch })), [])

  // Results of an earlier search in this repo stay up (dimmed) until the
  // current one answers.
  const current = result?.key === key ? result : null
  const shown = form.query ? (current ?? (result?.repo === repoPath ? result : null)) : null
  return {
    open,
    setOpen,
    show,
    form,
    update,
    data: shown?.data ?? null,
    error: current?.error ?? "",
    loading: open && !!form.query && !current,
    stale: !!shown && shown !== current,
  }
}

export type Search = ReturnType<typeof useSearch>
