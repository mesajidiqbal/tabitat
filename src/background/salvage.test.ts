import { describe, expect, it } from "vitest";
import { isWorkspaceMeta, isWorkspaceTabs, parseWorkspaceMeta } from "../core/model/schemas";
import type { WorkspaceMeta, WorkspaceTabs } from "../core/model/types";
import { rng } from "../core/testing/fixtures";
import { nonNegInt, salvageWorkspaceMeta, salvageWorkspaceTabs } from "./salvage";

const NOW = 1_800_000_000_000;

const validTabs = (): WorkspaceTabs => ({
  tabs: [
    { id: "t1", url: "https://a.example/", title: "A", index: 0, favIconUrl: "https://a/f.ico" },
    {
      id: "t2",
      url: "chrome://settings/",
      title: "S",
      index: 1,
      group: { id: "g", title: "G", color: "red", collapsed: false },
    },
    { id: "t3", url: "https://b.example/", title: "B", index: 2 },
  ],
  activeSavedTabId: "t2",
  updatedAt: NOW,
  rev: 3,
});

const validMeta = (): WorkspaceMeta => ({
  id: "w1",
  name: "W",
  color: "blue",
  emoji: "x",
  kind: "named",
  windowHint: 4,
  resources: [{ id: "l1", url: "https://l.example/", title: "L", order: 0, addedAt: NOW }],
  createdAt: NOW,
  updatedAt: NOW,
  rev: 2,
});

const JUNK: unknown[] = [
  undefined,
  null,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  -0.25,
  "",
  "garbage",
  "javascript:alert(1)",
  {},
  [],
  [1, 2],
  { nested: true },
  true,
  "__proto__",
  "a b",
];

function corrupt<T extends object>(value: T, rand: () => number): T {
  const copy = structuredClone(value) as Record<string, unknown>;
  const keys = Object.keys(copy);
  const key = keys[Math.floor(rand() * keys.length)] as string;
  const junk = JUNK[Math.floor(rand() * JUNK.length)];
  // either a top-level field, or (for arrays of items) one field of one item
  const field = copy[key];
  if (Array.isArray(field) && field.length > 0 && rand() < 0.5) {
    const item = field[Math.floor(rand() * field.length)] as Record<string, unknown>;
    const ik = Object.keys(item);
    item[ik[Math.floor(rand() * ik.length)] as string] = junk;
  } else if (junk === undefined) {
    delete copy[key];
  } else {
    copy[key] = junk;
  }
  return copy as T;
}

describe("salvage (W): single-field corruptions never lose the record", () => {
  it("nonNegInt yields schema-valid numbers", () => {
    expect(nonNegInt(5.9, 0)).toBe(5);
    expect(nonNegInt(-1, 7)).toBe(7);
    expect(nonNegInt(Number.NaN, 7)).toBe(7);
    expect(nonNegInt(Number.POSITIVE_INFINITY, 7)).toBe(7);
    expect(nonNegInt("3", 7)).toBe(7);
  });

  it("WorkspaceTabs: salvage never returns null and the result validates (property)", () => {
    const rand = rng(42);
    for (let i = 0; i < 500; i++) {
      const bad = corrupt(validTabs(), rand);
      const out = salvageWorkspaceTabs(bad, NOW);
      expect(out, JSON.stringify(bad)).not.toBeNull();
      expect(isWorkspaceTabs(out?.value), JSON.stringify(out?.value)).toBe(true);
      // valid tabs are kept: at most the one corrupted tab is dropped (unless `tabs` itself was
      // replaced, in which case the original is only in the corrupt copy)
      if (Array.isArray(bad.tabs) && bad.tabs.length === 3) {
        expect(out?.value.tabs.length ?? 0).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("WorkspaceMeta: salvage never returns null and the result validates (property)", () => {
    const rand = rng(7);
    for (let i = 0; i < 500; i++) {
      const bad = corrupt(validMeta(), rand);
      const out = salvageWorkspaceMeta(bad, "w1", NOW);
      expect(out, JSON.stringify(bad)).not.toBeNull();
      expect(isWorkspaceMeta(out?.value), JSON.stringify(out?.value)).toBe(true);
      expect(out?.value.id).toBe("w1");
    }
  });

  it("float/negative timestamps and a missing or mismatched id are repaired", () => {
    const meta = {
      ...validMeta(),
      createdAt: 1730000000.5,
      updatedAt: -3,
    } as Partial<WorkspaceMeta>;
    delete meta.id;
    const out = salvageWorkspaceMeta(meta, "w1", NOW);
    expect(parseWorkspaceMeta(out?.value)).toMatchObject({
      id: "w1",
      createdAt: 1730000000,
      updatedAt: NOW,
    });
    expect(salvageWorkspaceMeta({ ...validMeta(), id: "other" }, "w1", NOW)?.value.id).toBe("w1");
    const tabs = salvageWorkspaceTabs({ ...validTabs(), updatedAt: 12.75, rev: -1 }, NOW);
    expect(tabs?.value).toMatchObject({ updatedAt: 12, rev: 1 });
  });

  it("a dangling activeSavedTabId is cleared", () => {
    const t = validTabs();
    const out = salvageWorkspaceTabs(
      { ...t, tabs: t.tabs.slice(0, 1), activeSavedTabId: "t2" },
      NOW,
    );
    expect(out?.value.activeSavedTabId).toBeUndefined();
  });
});
