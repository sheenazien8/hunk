import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as kanban from "../plugins/kanban/store.mjs"
import * as kanbanMcp from "../plugins/kanban/mcp-tools.mjs"

interface Card { id: number; number: number; columnId: number; title: string; position: number; labels: number[]; files: string[] }
interface Board {
  name: string
  settings: Record<string, unknown>
  columns: { id: number; name: string; done: boolean }[]
  labels: { id: number; name: string }[]
  cards: Card[]
}
interface Store {
  board(project: string): Board
  archived(project: string): Card[]
  boards(): { project: string; name: string; cards: number }[]
  createCard(project: string, input: object): Card
  updateCard(project: string, id: number, input: object): Card
  moveCard(project: string, id: number, input: object): Card
  deleteColumn(project: string, id: number, moveTo?: number): void
  reorderColumns(project: string, ids: number[]): void
  createLabel(project: string, input: object): unknown
  deleteLabel(project: string, id: number): void
  updateSettings(project: string, input: object): Record<string, unknown>
  close(): void
}

const openStore = kanban.openStore as unknown as (file: string) => Store
type Tool = { name: string; handler: (args: object, context: { project: string | null }) => unknown }
const kanbanTools = kanbanMcp.kanbanTools as unknown as (store: Store, options?: { onChange?: () => void }) => Tool[]
const P = "/projects/a"

let store: Store
beforeEach(() => {
  store = openStore(":memory:")
})
afterEach(() => store.close())

function columnId(name: string, project = P) {
  return store.board(project).columns.find(c => c.name === name)!.id
}

function titles(column: string) {
  const id = columnId(column)
  return store.board(P).cards.filter(c => c.columnId === id).map(c => c.title)
}

describe("kanban store", () => {
  it("seeds a board per project with default columns, labels and settings", () => {
    const board = store.board(P)
    expect(board.name).toBe("a")
    expect(board.columns.map(c => c.name)).toEqual(["Backlog", "To do", "In progress", "Done"])
    expect(board.columns.at(-1)?.done).toBe(true)
    expect(board.labels.map(l => l.name)).toEqual(["bug", "chore", "feature"])
    expect(board.settings).toMatchObject({ cardPrefix: "CARD", compact: false })
    expect(store.board("/projects/b").cards).toEqual([])
  })

  it("numbers cards per project and orders them by position", () => {
    const todo = columnId("To do")
    store.createCard(P, { title: "one", columnId: todo })
    store.createCard(P, { title: "two", columnId: todo })
    const first = store.createCard(P, { title: "zero", columnId: todo, index: 0 })
    expect(first.number).toBe(3)
    expect(titles("To do")).toEqual(["zero", "one", "two"])
    expect(store.createCard("/projects/b", { title: "other" }).number).toBe(1)
  })

  it("moves cards between columns and keeps positions dense", () => {
    const todo = columnId("To do")
    const doing = columnId("In progress")
    const a = store.createCard(P, { title: "a", columnId: todo })
    store.createCard(P, { title: "b", columnId: todo })
    store.createCard(P, { title: "c", columnId: doing })
    store.moveCard(P, a.id, { columnId: doing, index: 1 })
    expect(titles("To do")).toEqual(["b"])
    expect(titles("In progress")).toEqual(["c", "a"])
    expect(store.board(P).cards.map(c => c.position).sort()).toEqual([0, 0, 1])
  })

  it("validates input and scopes ids to the project", () => {
    expect(() => store.createCard(P, { title: "  " })).toThrow("Title is required")
    expect(() => store.createCard(P, { title: "x", priority: "asap" })).toThrow(/Priority/)
    expect(() => store.createCard(P, { title: "x", due: "tomorrow" })).toThrow(/YYYY-MM-DD/)
    expect(() => store.createLabel(P, { name: "x", color: "red" })).toThrow(/#rrggbb/)
    const card = store.createCard(P, { title: "mine" })
    expect(() => store.updateCard("/projects/b", card.id, { title: "stolen" })).toThrow("Card not found")
  })

  it("archives, restores and filters unknown labels", () => {
    const bug = store.board(P).labels.find(l => l.name === "bug")!.id
    const card = store.createCard(P, { title: "x", labels: [bug, 9999], files: ["./src/a.ts", "src/a.ts"] })
    expect(card).toMatchObject({ labels: [bug], files: ["src/a.ts"] })
    store.updateCard(P, card.id, { archived: true })
    expect(store.board(P).cards).toEqual([])
    expect(store.archived(P).map(c => c.id)).toEqual([card.id])
    store.deleteLabel(P, bug)
    expect(store.updateCard(P, card.id, { archived: false }).labels).toEqual([])
  })

  it("refuses to delete a non-empty column unless its cards move", () => {
    const todo = columnId("To do")
    const done = columnId("Done")
    store.createCard(P, { title: "x", columnId: todo })
    expect(() => store.deleteColumn(P, todo)).toThrow(/choose where to move/)
    store.deleteColumn(P, todo, done)
    expect(titles("Done")).toEqual(["x"])
    expect(store.board(P).columns).toHaveLength(3)
  })

  it("updates settings and validates the card prefix", () => {
    expect(store.updateSettings(P, { name: "Roadmap", cardPrefix: "hnk", compact: true })).toMatchObject({ cardPrefix: "HNK", compact: true })
    expect(store.board(P).name).toBe("Roadmap")
    expect(() => store.updateSettings(P, { cardPrefix: "a-b" })).toThrow(/letters and digits/)
    expect(() => store.updateSettings(P, { name: "" })).toThrow(/required/)
  })

  it("lists boards with their active card counts", () => {
    store.createCard(P, { title: "x" })
    store.updateCard(P, store.createCard(P, { title: "y" }).id, { archived: true })
    store.board("/projects/b")
    expect(store.boards()).toEqual([{ project: P, name: "a", cards: 1 }, { project: "/projects/b", name: "b", cards: 0 }])
  })

  it("reorders columns only with the full list", () => {
    const ids = store.board(P).columns.map(c => c.id)
    expect(() => store.reorderColumns(P, ids.slice(1))).toThrow(/every column/)
    store.reorderColumns(P, [...ids].reverse())
    expect(store.board(P).columns.map(c => c.name)).toEqual(["Done", "In progress", "To do", "Backlog"])
  })
})

describe("kanban MCP tools", () => {
  function tools() {
    let changes = 0
    const list = kanbanTools(store, { onChange: () => changes++ })
    const call = (name: string, args: object = {}) => list.find(t => t.name === name)!.handler(args, { project: P }) as Record<string, unknown>
    return { call, changes: () => changes }
  }

  it("creates, finds, updates and moves cards by ID, column and label names", () => {
    const { call, changes } = tools()
    store.updateSettings(P, { cardPrefix: "HNK" })
    const created = call("create_card", { title: "Fix login", column: "to do", labels: ["Bug"], priority: "high" })
    expect(created).toMatchObject({ card: "HNK-1", column: "To do", labels: ["bug"], priority: "high", done: false })
    expect(call("get_card", { card: "hnk-1" })).toMatchObject({ title: "Fix login" })
    expect(call("update_card", { card: "#1", description: "JWT", labels: ["feature"] })).toMatchObject({ description: "JWT", labels: ["feature"] })
    expect(call("move_card", { card: "1", column: "Done" })).toMatchObject({ column: "Done", done: true })
    expect(changes()).toBe(3)
    expect(call("board")).toMatchObject({ cardPrefix: "HNK", columns: expect.arrayContaining([{ name: "Done", cards: 1, wipLimit: null, done: true }]) })
  })

  it("filters list_cards and hides archived cards unless asked", () => {
    const { call } = tools()
    call("create_card", { title: "alpha", column: "Backlog" })
    call("create_card", { title: "beta login", column: "To do", labels: ["bug"] })
    call("update_card", { card: "1", archived: true })
    expect((call("list_cards") as unknown as { title: string }[]).map(c => c.title)).toEqual(["beta login"])
    expect((call("list_cards", { include_archived: true }) as unknown as unknown[])).toHaveLength(2)
    expect((call("list_cards", { label: "bug", query: "LOGIN" }) as unknown as unknown[])).toHaveLength(1)
  })

  it("warns over the WIP limit and explains unknown names", () => {
    const { call } = tools()
    for (const t of ["a", "b", "c", "d"]) call("create_card", { title: t, column: "In progress" })
    const extra = call("create_card", { title: "e" })
    expect(call("move_card", { card: extra.card, column: "In progress", position: 0 })).toMatchObject({ warning: expect.stringContaining("WIP limit of 3") })
    expect(() => call("move_card", { card: "1", column: "Shipped" })).toThrow(/Columns: Backlog, To do, In progress, Done/)
    expect(() => call("create_card", { title: "x", labels: ["urgent"] })).toThrow(/Labels: bug, chore, feature/)
    expect(() => call("get_card", { card: "HNK-99" })).toThrow("No card HNK-99")
  })

  it("refuses calls without a project", () => {
    const board = kanbanTools(store).find(t => t.name === "board")!
    expect(() => board.handler({}, { project: null })).toThrow(/No project/)
  })
})
