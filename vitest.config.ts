import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [
    // WXT resolves a dev-server port for "serve" configs by probing localhost; a fixed, strict
    // port skips the probe so the unit tests run in sandboxes without network access. Nothing
    // listens on it: vitest never starts the WXT dev server.
    WxtVitest({ dev: { server: { port: 3999, strictPort: true } } }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".output*/**"],
  },
});
