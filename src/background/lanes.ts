/**
 * Per-lane serialization (ARCHITECTURE §5.1, ADR-003). A task names the lanes it needs
 * (`window:<id>`, `key:<storageKey>`, …) and runs after every earlier task on any of them.
 * All lanes are taken at enqueue time, in one step, so two tasks can never hold one lane each
 * while waiting for the other's. The special lane "*" is exclusive: it waits for everything
 * queued before it and everything queued after it waits for it.
 *
 * Rule for callers: never enqueue (and await) a task on a lane you already hold — that
 * deadlocks. Code that runs inside a lane calls the un-laned service methods directly.
 */
export const GLOBAL_LANE = "*";

const noop = () => {};

export class LaneQueue {
  private tails = new Map<string, Promise<void>>();
  private globalTail: Promise<void> = Promise.resolve();
  private active = new Map<string, number>();

  run<T>(lanes: readonly string[], fn: () => Promise<T>): Promise<T> {
    const unique = [...new Set(lanes)];
    if (unique.length === 0) return fn();
    const isGlobal = unique.includes(GLOBAL_LANE);
    const prev = isGlobal
      ? [this.globalTail, ...this.tails.values()]
      : [this.globalTail, ...unique.map((l) => this.tails.get(l)).filter((p) => p !== undefined)];
    for (const l of unique) this.active.set(l, (this.active.get(l) ?? 0) + 1);
    const result = Promise.all(prev).then(fn);
    const tail = result.then(noop, noop);
    if (isGlobal) {
      this.globalTail = tail;
      this.tails.clear();
    } else {
      for (const l of unique) this.tails.set(l, tail);
    }
    void tail.then(() => {
      for (const l of unique) {
        const n = (this.active.get(l) ?? 1) - 1;
        if (n <= 0) this.active.delete(l);
        else this.active.set(l, n);
        if (!isGlobal && this.tails.get(l) === tail) this.tails.delete(l);
      }
    });
    return result;
  }

  /** True while any task holding (or waiting for) `lane` has not finished. */
  isBusy(lane: string): boolean {
    return (this.active.get(lane) ?? 0) > 0;
  }
}

export const Lane = {
  window: (windowId: number) => `window:${windowId}`,
  key: (storageKey: string) => `key:${storageKey}`,
  wsIndex: "key:ws:index",
  /** All ws:meta:* records (renames, links, resources) share one lane: low contention. */
  wsMeta: "key:ws:meta",
  trash: "key:trash",
  sessions: "key:sessions",
  recentlyClosed: "key:recentlyClosed",
  global: GLOBAL_LANE,
} as const;
