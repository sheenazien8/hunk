import { spawn } from "child_process"
import http from "http"
import type { AddressInfo } from "net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mcpServersFor, pluginAgentEnv } from "./mcp"
import * as sdk from "../../../plugins/sdk/mcp.mjs"

type Tool = { name: string; description: string; handler: (args: unknown, context: unknown) => unknown }
const createMcpHandler = sdk.createMcpHandler as unknown as (options: { name: string; tools: Tool[] }) => (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>

let server: http.Server
let url = ""
const seen: http.IncomingHttpHeaders[] = []

beforeAll(async () => {
  const handle = createMcpHandler({
    name: "echo",
    tools: [
      { name: "whoami", description: "Echo the Hunk context", handler: (_: unknown, ctx: unknown) => ctx },
      { name: "boom", description: "Fails", handler: () => { throw new Error("nope") } },
    ],
  })
  server = http.createServer((req, res) => {
    seen.push(req.headers)
    void handle(req, res)
  })
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

const plugin = (mcp?: string) => ({ id: "echo", name: "Echo", url, mcp })
const context = { repo: "/work/app-feature", project: "/work/app" }

async function rpc(body: unknown) {
  const res = await fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", "x-hunk-project": "/p" }, body: JSON.stringify(body) })
  return { status: res.status, body: res.status === 202 ? null : await res.json() }
}

describe("plugin MCP helper", () => {
  it("answers initialize, tools/list and tools/call", async () => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })
    expect(init.body.result).toMatchObject({ protocolVersion: "2025-03-26", serverInfo: { name: "echo" }, capabilities: { tools: {} } })
    expect((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202)
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    expect(list.body.result.tools.map((t: { name: string }) => t.name)).toEqual(["whoami", "boom"])
    const call = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } })
    expect(JSON.parse(call.body.result.content[0].text)).toEqual({ repo: null, project: "/p" })
  })

  it("falls back to x-project-dir (the client's working directory) when Hunk sent no project", async () => {
    const call = (headers: Record<string, string>) => fetch(`${url}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "whoami" } }),
    }).then(r => r.json()).then(r => JSON.parse(r.result.content[0].text))
    expect(await call({ "x-project-dir": "/home/me/app/" })).toEqual({ repo: "/home/me/app", project: "/home/me/app" })
    expect(await call({ "x-hunk-project": "/work/app", "x-hunk-repo": "", "x-project-dir": "/elsewhere" })).toEqual({ repo: "/elsewhere", project: "/work/app" })
    expect(await call({ "x-project-dir": "/" })).toEqual({ repo: "/", project: "/" })
  })

  it("reports tool failures as tool errors and unknown methods as JSON-RPC errors", async () => {
    const failed = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "boom" } })
    expect(failed.body.result).toMatchObject({ isError: true, content: [{ text: "nope" }] })
    expect((await rpc({ jsonrpc: "2.0", id: 5, method: "nope" })).body.error.code).toBe(-32601)
  })
})

describe("mcpServersFor", () => {
  it("offers http servers with the Hunk context headers when the agent supports them", () => {
    expect(mcpServersFor([plugin("/mcp"), plugin()], { mcpCapabilities: { http: true } }, context)).toEqual([{
      type: "http",
      name: "echo",
      url: `${url}/mcp`,
      headers: [{ name: "x-hunk-repo", value: "/work/app-feature" }, { name: "x-hunk-project", value: "/work/app" }],
    }])
  })

  it("falls back to a stdio bridge that relays to the plugin", async () => {
    const [stdio] = mcpServersFor([plugin("/mcp")], {}, context)
    if ("type" in stdio) throw new Error("expected a stdio server")
    const child = spawn(stdio.command, stdio.args, { stdio: ["pipe", "pipe", "inherit"] })
    const lines: string[] = []
    child.stdout.setEncoding("utf8").on("data", (d: string) => lines.push(...d.split("\n").filter(Boolean)))
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n")
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "whoami" } }) + "\n")
    for (let i = 0; i < 50 && lines.length < 2; i++) await new Promise(r => setTimeout(r, 50))
    child.kill()
    expect(lines.map(l => JSON.parse(l).id)).toEqual([1, 2])
    expect(JSON.parse(JSON.parse(lines[1]).result.content[0].text)).toEqual(context)
    expect(seen.at(-1)?.["x-hunk-repo"]).toBe("/work/app-feature")
  })
})

describe("pluginAgentEnv", () => {
  it("tells config-file MCP clients (pi) which repo and project the agent runs in", async () => {
    expect(await pluginAgentEnv("/tmp/not-a-project")).toEqual({ HUNK_REPO: "/tmp/not-a-project", HUNK_PROJECT: "/tmp/not-a-project", PWD: "/tmp/not-a-project" })
  })
})
