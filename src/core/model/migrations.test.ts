import { afterEach, describe, expect, it } from "vitest";
import { NOW, rng } from "../testing/fixtures";
import {
  applyMigrations,
  diffSnapshots,
  type Migration,
  MigrationError,
  migrations,
  planMigrations,
  storedSchemaVersion,
} from "./migrations";
import { isMeta, isQuickLinks, isSettings, isTrash, parseSettings } from "./schemas";
import { DEFAULT_SETTINGS, SCHEMA_VERSION } from "./types";

const ctx = { now: NOW, flavor: "newtab" as const };

describe("migrations list", () => {
  it("is contiguous from 1 to SCHEMA_VERSION", () => {
    expect(migrations.map((m) => m.version)).toEqual(
      Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1),
    );
  });
});

describe("v1", () => {
  it("initialises a fresh install", () => {
    const out = applyMigrations({}, 0, 1, ctx);
    expect(out).toEqual({
      meta: { schemaVersion: 1, installedAt: NOW, flavor: "newtab" },
      settings: DEFAULT_SETTINGS,
      "ws:index": [],
      "sessions:index": [],
      recentlyClosed: [],
      trash: { items: [] },
      quicklinks: { items: [], rev: 0 },
    });
    expect(isMeta(out.meta)).toBe(true);
    expect(isSettings(out.settings)).toBe(true);
    expect(isTrash(out.trash)).toBe(true);
    expect(isQuickLinks(out.quicklinks)).toBe(true);
    expect(out.settings).not.toBe(DEFAULT_SETTINGS);
  });

  it("defaults the context", () => {
    const out = applyMigrations({}, 0);
    expect(out.meta).toEqual({ schemaVersion: 1, installedAt: 0, flavor: "default" });
  });

  it("never overwrites existing records and does not mutate its input", () => {
    const input = {
      meta: { schemaVersion: 0, installedAt: 5, flavor: "default" },
      settings: { theme: "dark" },
      "ws:index": ["a"],
      quicklinks: { items: [{ id: "q", url: "https://q.com", title: "Q", order: 0 }], rev: 3 },
      "ws:meta:a": { id: "a" },
    };
    const frozen = structuredClone(input);
    const out = applyMigrations(input, 0, 1, ctx);
    expect(input).toEqual(frozen);
    expect(out.meta).toEqual({ schemaVersion: 1, installedAt: 5, flavor: "default" });
    expect(out.settings).toEqual({ theme: "dark" });
    expect(parseSettings(out.settings).theme).toBe("dark");
    expect(out["ws:index"]).toEqual(["a"]);
    expect(out.quicklinks).toEqual(input.quicklinks);
    expect(out["ws:meta:a"]).toEqual({ id: "a" });
    expect(out.trash).toEqual({ items: [] });
  });

  it("repairs a meta without schemaVersion", () => {
    const out = applyMigrations({ meta: { installedAt: 1 } }, 0, 1, ctx);
    expect(out.meta).toEqual({ installedAt: 1, schemaVersion: 1 });
  });

  it("is idempotent (property: random partial snapshots)", () => {
    const keys = [
      "meta",
      "settings",
      "ws:index",
      "sessions:index",
      "recentlyClosed",
      "trash",
      "quicklinks",
      "ws:meta:x",
    ];
    const rand = rng(7);
    for (let i = 0; i < 100; i++) {
      const snap: Record<string, unknown> = {};
      for (const k of keys) if (rand() < 0.5) snap[k] = { marker: k, schemaVersion: 0 };
      for (const m of migrations) {
        const once = m.run(snap, ctx);
        expect(m.run(once, ctx)).toEqual(once);
      }
      const once = applyMigrations(snap, 0, SCHEMA_VERSION, ctx);
      expect(applyMigrations(once, 0, SCHEMA_VERSION, ctx)).toEqual(once);
    }
  });
});

describe("planMigrations", () => {
  const extra: Migration = { version: 3, run: (s) => s };
  afterEach(() => {
    const i = migrations.indexOf(extra);
    if (i !== -1) migrations.splice(i, 1);
  });

  it("returns pending migrations in order", () => {
    expect(planMigrations(0).map((m) => m.version)).toEqual([1]);
    expect(planMigrations(SCHEMA_VERSION)).toEqual([]);
    expect(applyMigrations({ a: 1 }, SCHEMA_VERSION)).toEqual({ a: 1 });
  });

  it("refuses to downgrade", () => {
    expect(() => planMigrations(SCHEMA_VERSION + 1)).toThrow(MigrationError);
  });

  it("detects gaps and missing tail steps", () => {
    migrations.push(extra);
    expect(() => planMigrations(0, 3)).toThrow(/missing migration v2/);
    expect(() => planMigrations(1, 4)).toThrow(/missing migration v2/);
    expect(() => planMigrations(0, 2)).toThrow(/missing migration v2/);
  });
});

describe("helpers", () => {
  it("storedSchemaVersion", () => {
    expect(storedSchemaVersion({})).toBe(0);
    expect(storedSchemaVersion({ meta: { schemaVersion: 4 } })).toBe(4);
    expect(storedSchemaVersion({ meta: [] })).toBe(0);
  });

  it("diffSnapshots", () => {
    const before = { a: 1, b: { x: 1 }, c: 3 };
    const after = { a: 1, b: { x: 1 }, d: 4, e: { y: 1 } };
    expect(diffSnapshots(before, after)).toEqual({ set: { d: 4, e: { y: 1 } }, remove: ["c"] });
    expect(diffSnapshots({ a: { x: 1 } }, { a: { x: 2 } })).toEqual({
      set: { a: { x: 2 } },
      remove: [],
    });
  });
});
