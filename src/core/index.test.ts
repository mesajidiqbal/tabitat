import { describe, expect, it } from "vitest";
import * as core from "./index";

describe("core public API", () => {
  it("re-exports the domain modules", () => {
    for (const name of [
      "parseSettings",
      "SchemaError",
      "migrations",
      "applyMigrations",
      "classifyUrl",
      "buildPlaceholderUrl",
      "snapshotWindow",
      "planSwitch",
      "canResume",
      "matchWindows",
      "SearchIndex",
      "eligibleForDiscard",
      "findDuplicates",
      "buildBackup",
      "planImport",
      "Keys",
      "newId",
    ]) {
      expect(core).toHaveProperty(name);
    }
    expect(typeof core.pomodoro.start).toBe("function");
  });
});
