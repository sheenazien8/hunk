import { beforeAll, describe, expect, it } from "vitest"

type Markdown = {
  renderMarkdown(source: string, options?: { interactive?: boolean }): string
  toggleTask(source: string, index: number): string
  taskProgress(source: string): { done: number; total: number }
}
let md: Markdown

beforeAll(async () => {
  // @ts-expect-error browser script (sets globalThis.kanbanMarkdown), not an ES module
  await import("../plugins/kanban/public/markdown.js")
  md = (globalThis as unknown as { kanbanMarkdown: Markdown }).kanbanMarkdown
})

const render = (s: string) => md.renderMarkdown(s)

describe("kanban markdown", () => {
  it("escapes HTML and refuses dangerous URLs", () => {
    expect(render("<script>alert(1)</script> <img src=x onerror=alert(1)>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt; &lt;img src=x onerror=alert(1)&gt;</p>")
    expect(render("[x](javascript:alert(1))")).toBe("<p>x)</p>")
    expect(render("[x](data:text/html,hi)")).toBe("<p>x</p>")
    expect(render('[x](https://a.com/"onmouseover=alert(1))')).toContain('href="https://a.com/&quot;onmouseover=alert(1"')
    expect(render("![p](javascript:alert(1))")).toBe("<p>p)</p>")
  })

  it("renders headings, emphasis, strikethrough and code", () => {
    expect(render("## Title ##")).toBe("<h2>Title</h2>")
    expect(render("#tag")).toBe("<p>#tag</p>")
    expect(render("**bold** *it* _it_ ~~gone~~ snake_case_name 2*3*4")).toBe(
      "<p><strong>bold</strong> <em>it</em> <em>it</em> <del>gone</del> snake_case_name 2*3*4</p>")
    expect(render("use `<b>*x*</b>` here")).toBe("<p>use <code>&lt;b&gt;*x*&lt;/b&gt;</code> here</p>")
    expect(render("```ts\nconst a = 1 < 2\n```")).toBe('<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>')
    expect(render("line one\nline two")).toBe("<p>line one<br>line two</p>")
    expect(render("\\*not em\\*")).toBe("<p>*not em*</p>")
  })

  it("renders links: external in a new tab, relative ones as repo files", () => {
    expect(render("[docs](https://x.dev/a?b=1&c=2)")).toBe('<p><a href="https://x.dev/a?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs</a></p>')
    expect(render("see [`main.ts`](./src/main.ts#L42)")).toBe('<p>see <a href="./src/main.ts#L42" data-file="src/main.ts" data-line="42"><code>main.ts</code></a></p>')
    expect(render("go to https://hunk.dev/x.")).toBe('<p>go to <a href="https://hunk.dev/x" target="_blank" rel="noopener noreferrer">https://hunk.dev/x</a>.</p>')
    expect(render("![logo](https://x.dev/l.png)")).toBe('<p><img src="https://x.dev/l.png" alt="logo" loading="lazy"></p>')
  })

  it("renders nested, ordered and task lists", () => {
    expect(render("- a\n  - b\n- c")).toBe("<ul><li>a<ul><li>b</li></ul></li><li>c</li></ul>")
    expect(render("3. three\n4. four")).toBe('<ol start="3"><li>three</li><li>four</li></ol>')
    expect(render("- [ ] todo\n- [x] done")).toBe(
      '<ul><li class="task-item"><input type="checkbox" class="task" data-task="0" disabled> todo</li>'
      + '<li class="task-item"><input type="checkbox" class="task" data-task="1" checked disabled> done</li></ul>')
    expect(md.renderMarkdown("- [ ] a", { interactive: true })).not.toContain("disabled")
  })

  it("keeps text after a task checkbox inline, even when it looks like a list or heading", () => {
    expect(render("- [x] 1. **Route:** `POST /x`\n- [ ] # not a heading\n- [ ] - not nested")).toBe(
      '<ul><li class="task-item"><input type="checkbox" class="task" data-task="0" checked disabled> 1. <strong>Route:</strong> <code>POST /x</code></li>'
      + '<li class="task-item"><input type="checkbox" class="task" data-task="1" disabled> # not a heading</li>'
      + '<li class="task-item"><input type="checkbox" class="task" data-task="2" disabled> - not nested</li></ul>')
    expect(render("- [ ] parent\n  continued\n  - [x] child")).toBe(
      '<ul><li class="task-item"><input type="checkbox" class="task" data-task="0" disabled> parent<br>continued'
      + '<ul><li class="task-item"><input type="checkbox" class="task" data-task="1" checked disabled> child</li></ul></li></ul>')
    expect(md.taskProgress("- [x] 1. a\n- [ ] 2. b")).toEqual({ done: 1, total: 2 })
  })

  it("renders tables with alignment, quotes and rules", () => {
    expect(render("| a | b |\n|:--|--:|\n| 1 | 2 \\| 3 |")).toBe(
      '<table><thead><tr><th style="text-align:left">a</th><th style="text-align:right">b</th></tr></thead>'
      + '<tbody><tr><td style="text-align:left">1</td><td style="text-align:right">2 | 3</td></tr></tbody></table>')
    expect(render("> quoted\n> **text**")).toBe("<blockquote><p>quoted<br><strong>text</strong></p></blockquote>")
    expect(render("a\n\n---\n\nb")).toBe("<p>a</p>\n<hr>\n<p>b</p>")
  })

  it("toggles and counts tasks, skipping fenced code", () => {
    const src = "- [ ] one\n```\n- [ ] not a task\n```\n1. [x] two\n- [ ] three"
    expect(md.taskProgress(src)).toEqual({ done: 1, total: 3 })
    expect(md.toggleTask(src, 0)).toBe(src.replace("- [ ] one", "- [x] one"))
    expect(md.toggleTask(src, 1)).toBe(src.replace("1. [x] two", "1. [ ] two"))
    expect(md.toggleTask(src, 2)).toBe(src.replace("- [ ] three", "- [x] three"))
    expect(md.toggleTask(src, 9)).toBe(src)
  })
})
