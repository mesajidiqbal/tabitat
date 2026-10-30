import { defineConfig } from "vitest/config";
import { WxtVitest } from "wxt/testing/vitest-plugin";

export default defineConfig({
  plugins: [
    // WXT resolves a dev-server port for "serve" configs by probing localhost; a fixed, strict
    // port skips the probe so the unit tests run in sandboxes without network access. Nothing
    // listens on it: vitest never starts the WXT dev server.
    WxtVitest({ dev: { server: { port: 3999, strictPort: true } } }),
  ],
  // Unit tests run without chrome.i18n: `t()` falls back to the en messages (src/i18n).
  define: { __TABITAT_I18N_FALLBACK__: "true" },
  test: {
    // Component tests are named *.dom.test.tsx and opt into happy-dom per file
    // (`// @vitest-environment happy-dom`); everything else runs in node.
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.dom.test.tsx"],
    exclude: ["tests/e2e/**", "node_modules/**", ".output*/**"],
  },
});
