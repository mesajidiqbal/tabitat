/**
 * Ordered, pure, idempotent storage migrations (ARCHITECTURE §6). Each migration maps a full
 * storage.local key/value snapshot to the next snapshot; the caller diffs and persists it and
 * records `migration:<n>` progress.
 */
import type { Flavor, Meta } from "./types";
import { DEFAULT_SETTINGS, Keys, SCHEMA_VERSION } from "./types";

/** Values a migration may need that are not in storage. */
export interface MigrationContext {
  /** Used for `meta.installedAt` on fresh installs. */
  now: number;
  flavor: Flavor;
}

export interface Migration {
  version: number;
  /** Pure: must not mutate `snapshot`; running it twice must yield the same result as once. */
  run(snapshot: Record<string, unknown>, ctx?: MigrationContext): Record<string, unknown>;
}

export class MigrationError extends Error {
  override readonly name = "MigrationError";
}

const DEFAULT_CONTEXT: MigrationContext = { now: 0, flavor: "default" };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** v1: initial layout. Writes missing top-level records; never overwrites existing ones. */
const v1: Migration = {
  version: 1,
  run(snapshot, ctx = DEFAULT_CONTEXT) {
    const out: Record<string, unknown> = { ...snapshot };
    const setIfMissing = (key: string, value: () => unknown) => {
      if (out[key] === undefined) out[key] = value();
    };

    const meta = out[Keys.meta];
    if (isRecord(meta)) {
      const prev = typeof meta.schemaVersion === "number" ? meta.schemaVersion : 0;
      out[Keys.meta] = { ...meta, schemaVersion: Math.max(prev, 1) };
    } else {
      out[Keys.meta] = {
        schemaVersion: 1,
        installedAt: ctx.now,
        flavor: ctx.flavor,
      } satisfies Meta;
    }
    setIfMissing(Keys.settings, () => structuredClone(DEFAULT_SETTINGS));
    setIfMissing(Keys.wsIndex, () => []);
    setIfMissing(Keys.sessionsIndex, () => []);
    setIfMissing(Keys.recentlyClosed, () => []);
    setIfMissing(Keys.trash, () => ({ items: [] }));
    setIfMissing(Keys.quicklinks, () => ({ items: [], rev: 0 }));
    return out;
  },
};

export const migrations: Migration[] = [v1];

/**
 * Migrations to run to go from `currentVersion` to `target`, in order.
 * Throws MigrationError when the data is newer than this build (downgrade) or a step is missing.
 */
export function planMigrations(currentVersion: number, target = SCHEMA_VERSION): Migration[] {
  if (currentVersion > target) {
    throw new MigrationError(
      `stored schema v${currentVersion} is newer than supported v${target}; refusing to downgrade`,
    );
  }
  const plan = migrations
    .filter((m) => m.version > currentVersion && m.version <= target)
    .sort((a, b) => a.version - b.version);
  plan.forEach((m, i) => {
    if (m.version !== currentVersion + i + 1) {
      throw new MigrationError(`missing migration v${currentVersion + i + 1}`);
    }
  });
  if (plan.length !== target - currentVersion) {
    throw new MigrationError(`missing migration v${currentVersion + plan.length + 1}`);
  }
  return plan;
}

/** Runs every migration in (from, to] over a copy of `snapshot`. */
export function applyMigrations(
  snapshot: Record<string, unknown>,
  from: number,
  to: number = SCHEMA_VERSION,
  ctx?: MigrationContext,
): Record<string, unknown> {
  return planMigrations(from, to).reduce((acc, m) => m.run(acc, ctx), { ...snapshot });
}

/** Reads `meta.schemaVersion` from a snapshot; 0 for a fresh install. */
export function storedSchemaVersion(snapshot: Record<string, unknown>): number {
  const meta = snapshot[Keys.meta];
  return isRecord(meta) && typeof meta.schemaVersion === "number" ? meta.schemaVersion : 0;
}

/** Keys to set/remove to turn `before` into `after` (shallow, by reference/JSON equality). */
export function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(after)) {
    if (before[k] === val) continue;
    if (k in before && JSON.stringify(before[k]) === JSON.stringify(val)) continue;
    set[k] = val;
  }
  const remove = Object.keys(before).filter((k) => !(k in after));
  return { set, remove };
}
