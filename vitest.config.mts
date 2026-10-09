import { defineConfig } from "vitest/config"
import path from "path"
import { fileURLToPath } from "url"

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // `server-only` throws outside the react-server condition — stub it for tests
      "server-only": path.resolve(root, "test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    env: { HUNK_PLUGINS_CONFIG: "/nonexistent/plugins.json" },
  },
})
