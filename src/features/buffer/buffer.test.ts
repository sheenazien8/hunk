import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  type BufferState,
  TAB_CAP,
  bufferReducer,
  commitTabKey,
  committedStagedTabs,
  emptyBuffer,
  newEntry,
  pluginTabKey,
  readPersistedBuffer,
  writePersistedBuffer,
} from "./buffer"

const repo = "/repo"
const entry = (file: string, extra: Partial<ReturnType<typeof newEntry>> = {}) => ({
  ...newEntry(repo, { file, staged: false, fromAll: false }),
  ...extra,
})

function openAll(files: string[]): BufferState {
  return files.reduce((s, f) => bufferReducer(s, { type: "open", entry: entry(f) }), emptyBuffer)
}

describe("bufferReducer", () => {
  it("opens tabs once and activates them", () => {
    let s = openAll(["a", "b"])
    s = bufferReducer(s, { type: "open", entry: entry("a") })
    expect(s.entries.map(e => e.file)).toEqual(["a", "b"])
    expect(s.activeId).toBe(entry("a").id)
  })

  it("activates the right neighbour when closing the active tab", () => {
    let s = openAll(["a", "b", "c"])
    s = bufferReducer(s, { type: "activate", id: entry("b").id })
    s = bufferReducer(s, { type: "close", id: entry("b").id })
    expect(s.activeId).toBe(entry("c").id)
    s = bufferReducer(s, { type: "close", id: entry("c").id })
    expect(s.activeId).toBe(entry("a").id)
    s = bufferReducer(s, { type: "close", id: entry("a").id })
    expect(s).toEqual(emptyBuffer)
  })

  it("keeps the active tab when closing another", () => {
    const s = bufferReducer(openAll(["a", "b"]), { type: "close", id: entry("a").id })
    expect(s.activeId).toBe(entry("b").id)
  })

  it("evicts the oldest clean, inactive tab past the cap", () => {
    const files = Array.from({ length: TAB_CAP }, (_, i) => `f${i}`)
    let s = openAll(files)
    s = bufferReducer(s, { type: "update", id: entry("f0").id, patch: { dirty: true } })
    s = bufferReducer(s, { type: "open", entry: entry("new") })
    expect(s.entries).toHaveLength(TAB_CAP)
    expect(s.entries.map(e => e.file)).not.toContain("f1")
    expect(s.entries.map(e => e.file)).toContain("f0")
    expect(s.activeId).toBe(entry("new").id)
  })

  it("keys commit tabs by sha alone", () => {
    const a = newEntry(repo, commitTabKey("abc123", "x.ts"))
    const b = newEntry(repo, commitTabKey("abc123", "y.ts"))
    expect(a.id).toBe(b.id)
    expect(a.id).not.toBe(entry("").id)
    expect(a).toMatchObject({ file: "", commit: "abc123", commitFile: "x.ts", commitData: null })
    const s = bufferReducer(bufferReducer(emptyBuffer, { type: "open", entry: a }), { type: "open", entry: b })
    expect(s.entries).toHaveLength(1)
  })

  it("updates a single entry", () => {
    const s = bufferReducer(openAll(["a", "b"]), { type: "update", id: entry("a").id, patch: { diff: "x" } })
    expect(s.entries.map(e => e.diff)).toEqual(["x", ""])
  })
})

describe("closeMany", () => {
  it("closes the given tabs and keeps the active one when it survives", () => {
    const s = bufferReducer(openAll(["a", "b", "c", "d"]), { type: "activate", id: entry("b").id })
    const next = bufferReducer(s, { type: "closeMany", ids: [entry("a").id, entry("c").id] })
    expect(next.entries.map(e => e.file)).toEqual(["b", "d"])
    expect(next.activeId).toBe(entry("b").id)
  })

  it("moves to the next survivor on the right, else the last one", () => {
    const s = bufferReducer(openAll(["a", "b", "c", "d"]), { type: "activate", id: entry("b").id })
    expect(bufferReducer(s, { type: "closeMany", ids: [entry("b").id, entry("c").id] }).activeId).toBe(entry("d").id)
    expect(bufferReducer(s, { type: "closeMany", ids: [entry("b").id, entry("c").id, entry("d").id] }).activeId).toBe(entry("a").id)
  })

  it("empties the buffer on close all", () => {
    const s = openAll(["a", "b"])
    expect(bufferReducer(s, { type: "closeMany", ids: s.entries.map(e => e.id) })).toEqual(emptyBuffer)
  })
})

describe("remap / closeUnder", () => {
  const keepSide = (file: string, b: ReturnType<typeof entry>) => ({ file, staged: b.staged, fromAll: b.fromAll })

  it("moves tabs on and under a renamed path, keeping the active one", () => {
    let s = openAll(["src/a.ts", "src/lib/b.ts", "srcx/c.ts"])
    s = bufferReducer(s, { type: "open", entry: newEntry(repo, commitTabKey("abc")) })
    s = bufferReducer(s, { type: "activate", id: entry("src/lib/b.ts").id })
    s = bufferReducer(s, { type: "update", id: entry("src/lib/b.ts").id, patch: { dirty: true, editContent: "x" } })
    s = bufferReducer(s, { type: "remap", repo, from: "src", to: "app", keyFor: keepSide })
    expect(s.entries.map(e => e.file)).toEqual(["app/a.ts", "app/lib/b.ts", "srcx/c.ts", ""])
    expect(s.activeId).toBe(entry("app/lib/b.ts").id)
    expect(s.entries[1]).toMatchObject({ dirty: true, editContent: "x" })
  })

  it("can change the tab key and merges duplicates", () => {
    let s = bufferReducer(emptyBuffer, { type: "open", entry: entry("a.ts") })
    s = bufferReducer(s, { type: "open", entry: newEntry(repo, { file: "a.ts", staged: false, fromAll: true }) })
    s = bufferReducer(s, { type: "remap", repo, from: "a.ts", to: "b.ts", keyFor: file => ({ file, staged: true, fromAll: false }) })
    expect(s.entries).toHaveLength(1)
    expect(s.entries[0]).toMatchObject({ file: "b.ts", staged: true, id: `${repo}::b.ts::s::d` })
    expect(s.activeId).toBe(s.entries[0].id)
  })

  it("leaves the state alone when nothing matches", () => {
    const s = openAll(["a.ts"])
    expect(bufferReducer(s, { type: "remap", repo, from: "x", to: "y", keyFor: keepSide })).toBe(s)
  })

  it("closes tabs under a deleted folder", () => {
    let s = openAll(["d/a.ts", "keep.ts", "d/e/b.ts"])
    s = bufferReducer(s, { type: "closeUnder", path: "d" })
    expect(s.entries.map(e => e.file)).toEqual(["keep.ts"])
    expect(s.activeId).toBe(entry("keep.ts").id)
  })
})

describe("persistence", () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    })
  })

  it("round-trips the tab list and active tab per repo", () => {
    const s = bufferReducer(openAll(["a", "b"]), { type: "activate", id: entry("a").id })
    writePersistedBuffer(repo, s)
    const restored = readPersistedBuffer(repo)
    expect(restored.entries.map(e => e.file)).toEqual(["a", "b"])
    expect(restored.activeId).toBe(entry("a").id)
    expect(readPersistedBuffer("/other")).toEqual(emptyBuffer)
  })

  it("round-trips commit tabs", () => {
    const commit = newEntry(repo, commitTabKey("abc123", "x.ts"))
    writePersistedBuffer(repo, bufferReducer(openAll(["a"]), { type: "open", entry: commit }))
    const restored = readPersistedBuffer(repo)
    expect(restored.entries.map(e => [e.file, e.commit, e.commitFile])).toEqual([["a", undefined, undefined], ["", "abc123", "x.ts"]])
    expect(restored.activeId).toBe(commit.id)
  })

  it("round-trips plugin tabs and leaves them out of remap / closeUnder", () => {
    const plugin = newEntry(repo, pluginTabKey("plans"))
    expect(plugin.id).toBe(`${repo}::plugin::plans`)
    let s = bufferReducer(openAll(["a"]), { type: "open", entry: plugin })
    s = bufferReducer(s, { type: "remap", repo, from: "", to: "x", keyFor: file => ({ file, staged: false, fromAll: false }) })
    s = bufferReducer(s, { type: "closeUnder", path: "" })
    expect(s.entries.map(e => e.id)).toEqual([entry("a").id, plugin.id])
    writePersistedBuffer(repo, s)
    expect(readPersistedBuffer(repo).entries.map(e => e.plugin)).toEqual([undefined, "plans"])
  })

  it("falls back to the first tab when the stored active id is stale", () => {
    localStorage.setItem(`hunk-tabs-${btoa(repo)}`, JSON.stringify({ tabs: [{ file: "a", staged: false, fromAll: true }], activeId: "gone" }))
    expect(readPersistedBuffer(repo).activeId).toBe(newEntry(repo, { file: "a", staged: false, fromAll: true }).id)
  })

  it("ignores malformed data", () => {
    localStorage.setItem(`hunk-tabs-${btoa(repo)}`, "{nope")
    expect(readPersistedBuffer(repo)).toEqual(emptyBuffer)
  })
})

describe("committedStagedTabs", () => {
  it("picks staged tabs whose file has nothing staged any more", () => {
    const tabs = [
      entry("a.ts", { staged: true }),
      entry("b.ts", { staged: true }),
      entry("a.ts"),
      entry("c.ts", { staged: true, dirty: true }),
      { ...newEntry(repo, commitTabKey("abc123")), staged: true },
    ]
    const fresh = [
      { path: "a.ts", staged: false },
      { path: "b.ts", staged: true },
    ]
    expect(committedStagedTabs(tabs, fresh).map(e => e.id)).toEqual([tabs[0].id])
  })
})
