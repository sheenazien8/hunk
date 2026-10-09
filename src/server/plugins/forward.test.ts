import http from "http"
import type { AddressInfo } from "net"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { forwardToPlugin } from "./forward"

let server: http.Server
let url = ""

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = ""
    req.on("data", c => (body += c))
    req.on("end", () => {
      if (req.url === "/go") {
        res.writeHead(302, { location: "/there", "set-cookie": "x=1" })
        return res.end()
      }
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ method: req.method, url: req.url, body, headers: req.headers }))
    })
  })
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => server.close())

describe("forwardToPlugin", () => {
  const plugin = () => ({ id: "echo", name: "Echo", url })

  it("forwards method, path, query and body without the session cookie", async () => {
    const req = new NextRequest("http://hunk.test/plugins/echo/api/a%20b?x=1", {
      method: "POST",
      body: "hello",
      headers: { cookie: "hunk-session=secret", "x-hunk-repo": "/etc", "x-project-dir": "/etc" },
    })
    const res = await forwardToPlugin(req, plugin(), ["api", "a b"], "me")
    const echoed = await res.json()
    expect(echoed).toMatchObject({ method: "POST", url: "/api/a%20b?x=1", body: "hello" })
    expect(echoed.headers.cookie).toBeUndefined()
    expect(echoed.headers["x-hunk-repo"]).toBeUndefined()
    expect(echoed.headers["x-project-dir"]).toBeUndefined()
    expect(echoed.headers["x-hunk-user"]).toBe("me")
    expect(echoed.headers["x-forwarded-prefix"]).toBe("/plugins/echo")
  })

  it("rewrites root-relative redirects under the plugin prefix and drops cookies", async () => {
    const res = await forwardToPlugin(new NextRequest("http://hunk.test/plugins/echo/go"), plugin(), ["go"], "me")
    expect(res.status).toBe(302)
    expect(res.headers.get("location")).toBe("/plugins/echo/there")
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("reports an unreachable plugin as 502", async () => {
    const req = new NextRequest("http://hunk.test/plugins/echo")
    await expect(forwardToPlugin(req, { ...plugin(), url: "http://127.0.0.1:1" }, [], "me")).rejects.toMatchObject({ status: 502 })
  })
})
