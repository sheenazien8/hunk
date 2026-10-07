// Pure multi-select logic for the sidebar trees (Ctrl/Cmd+click, Shift+click,
// Shift+arrows, select all).
import type { TreeNode } from "./tree"

export interface Selection {
  paths: ReadonlySet<string>
  // The row the last plain click / toggle was on; ranges start here.
  anchor: string | null
}

export const emptySelection: Selection = { paths: new Set(), anchor: null }

// Rows in display order: a folder's children follow it only while expanded.
export function visiblePaths(nodes: TreeNode[], isExpanded: (path: string) => boolean): string[] {
  const out: string[] = []
  const walk = (level: TreeNode[]) => {
    for (const n of level) {
      out.push(n.path)
      if (n.type === "dir" && isExpanded(n.path)) walk(n.children)
    }
  }
  walk(nodes)
  return out
}

// Plain click: no selection, just a new anchor.
export function clickRow(sel: Selection, path: string): Selection {
  return sel.paths.size === 0 && sel.anchor === path ? sel : { paths: new Set(), anchor: path }
}

// Ctrl/Cmd+click: toggle `path`. Starting a selection takes the anchor (the
// row clicked before) along, like VS Code.
export function toggleRow(sel: Selection, path: string, order: string[]): Selection {
  const paths = new Set(sel.paths)
  if (paths.size === 0 && sel.anchor && sel.anchor !== path && order.includes(sel.anchor)) paths.add(sel.anchor)
  if (paths.has(path)) paths.delete(path)
  else paths.add(path)
  return { paths, anchor: path }
}

// Shift+click / Shift+arrow: the visible rows from the anchor to `path`
// (the anchor stays put so the range can grow and shrink).
export function selectRange(sel: Selection, path: string, order: string[]): Selection {
  const anchor = sel.anchor && order.includes(sel.anchor) ? sel.anchor : path
  const a = order.indexOf(anchor)
  const b = order.indexOf(path)
  if (b === -1) return sel
  const [from, to] = a <= b ? [a, b] : [b, a]
  return { paths: new Set(order.slice(from, to + 1)), anchor }
}

export function selectAll(sel: Selection, order: string[]): Selection {
  return { paths: new Set(order), anchor: sel.anchor }
}

// Drops selected paths that no longer exist (renamed, deleted, staged away).
export function pruneSelection(sel: Selection, exists: (path: string) => boolean): Selection {
  const kept = [...sel.paths].filter(exists)
  return kept.length === sel.paths.size ? sel : { paths: new Set(kept), anchor: sel.anchor }
}
