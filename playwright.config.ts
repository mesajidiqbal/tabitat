import { defineConfig } from "@playwright/test";

export default defineConfig({
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  projects: [
    { name: "e2e", testDir: "tests/e2e", timeout: 30_000 },
    { name: "spike", testDir: "tests/spike", timeout: 120_000 },
  ],
});
