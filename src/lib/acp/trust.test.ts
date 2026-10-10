import { expect, it } from "vitest"
import { asksForTrust } from "./trust"

it("spots agents asking for project trust", () => {
  expect(asksForTrust("This project is not trusted. Use /trust to save a trust decision")).toBe(true)
  expect(asksForTrust("Trust project folder?\n/r/repo")).toBe(true)
  expect(asksForTrust("accept the trust dialog here once interactively")).toBe(true)
  expect(asksForTrust("Configure TrustProxies middleware")).toBe(false)
  expect(asksForTrust("Hello")).toBe(false)
})
