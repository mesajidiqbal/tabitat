/**
 * Local edits over a revisioned worker record (todo lists, quick links). Edits are pure ops kept
 * until the worker acknowledges them and shown applied over the latest known record, so a change
 * from another surface rebases them. Rapid edits coalesce into one write after `delay` ms (whole
 * value, `expectedRev`). A `conflict` re-reads storage and replays the ops on the fresh record
 * (at most 3 times). When the retries run out, another error comes back, or an op cannot apply
 * on the replayed record (e.g. the list filled up elsewhere), the ops stay queued and `error`
 * says why until the user picks `retry()` or `discard()` (review C-B2 / C-U3).
 *
 * The queue (ops, error, retry count, write state) lives in a module-level store keyed by `id`,
 * like note drafts (noteDrafts.ts), not in the component: a scope switch, a collapsed panel
 * section or a widget toggled off unmounts the editor, and a remount with the same id adopts the
 * queue, so the Retry / Discard row comes back with the pending edits (review C5.3). Only closing
 * the page loses a failed edit (`pagehide` still flushes what can be written).
 */
import { useEffect, useState } from "preact/hooks";
import { t } from "@/i18n";
import { RpcError } from "@/messaging/errors";
import { errorInfo } from "../actions";

export interface Versioned<V> {
  value: V;
  rev: number;
}

export interface SyncedRecordOptions<V> {
  /** Stable key of the record (e.g. its storage key `todos:<scope>`): the queue it shares. */
  id: string;
  /** The record as the store has it now. */
  stored: Versioned<V>;
  /** Writes the whole value; resolves with the new rev. */
  write: (value: V, expectedRev: number) => Promise<number>;
  /** Reads the record from storage (after a conflict). */
  reread: () => Promise<Versioned<V>>;
  delay: number;
}

export interface ApplyOptions<V> {
  /** Why the op cannot apply on `v` (localized), or null. Checked on every replay. */
  check?: (v: V) => string | null;
  /** Write now instead of after the coalescing delay (adds: the input waits for the ack). */
  immediate?: boolean;
}

interface PendingOp<V> {
  run: (v: V) => V;
  check: ((v: V) => string | null) | undefined;
  /** Settles the promise `apply` returned: true once written, false when discarded. */
  done: (written: boolean) => void;
}

/** One record's queue, shared by every editor mounted with its id (and kept between them). */
interface QueueState<V> {
  ops: Array<PendingOp<V>>;
  error: string | null;
  retries: number;
  /** Our last acknowledged write (or a fresh read): shown until the store catches up. */
  known: Versioned<V> | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  inFlight: boolean;
  again: boolean;
  /** The options of the editor rendered last (stored record, write / reread). */
  opts: SyncedRecordOptions<V>;
  /** Re-renders of the mounted editors. */
  listeners: Set<() => void>;
}

const MAX_CONFLICT_RETRIES = 3;
const queues = new Map<string, QueueState<unknown>>();

function queueFor<V>(opts: SyncedRecordOptions<V>): QueueState<V> {
  let q = queues.get(opts.id) as QueueState<V> | undefined;
  if (!q) {
    q = {
      ops: [],
      error: null,
      retries: 0,
      known: null,
      timer: undefined,
      inFlight: false,
      again: false,
      opts,
      listeners: new Set(),
    };
    queues.set(opts.id, q as QueueState<unknown>);
  }
  q.opts = opts;
  return q;
}

/** Forgets a queue nobody shows and nothing is left in (no edits, error or write). */
function prune(id: string): void {
  const q = queues.get(id);
  if (
    q &&
    q.listeners.size === 0 &&
    q.ops.length === 0 &&
    q.error === null &&
    !q.inFlight &&
    q.timer === undefined
  )
    queues.delete(id);
}

const rerender = <V>(q: QueueState<V>) => {
  for (const l of q.listeners) l();
};

const base = <V>(q: QueueState<V>): Versioned<V> => {
  const k = q.known;
  return k && k.rev > q.opts.stored.rev ? k : q.opts.stored;
};

const fail = <V>(q: QueueState<V>, text: string) => {
  q.retries = 0;
  q.error = text;
  rerender(q);
};

function flush<V>(q: QueueState<V>): void {
  clearTimeout(q.timer);
  q.timer = undefined;
  if (q.ops.length === 0 || q.error !== null) return;
  if (q.inFlight) {
    q.again = true;
    return;
  }
  const batch = q.ops.slice();
  const b = base(q);
  let next = b.value;
  for (const op of batch) {
    const why = op.check?.(next) ?? null;
    if (why !== null) {
      fail(q, why);
      return;
    }
    next = op.run(next);
  }
  q.inFlight = true;
  const o = q.opts;
  o.write(next, b.rev)
    .then((rev) => {
      q.known = { value: next, rev };
      q.ops.splice(0, batch.length);
      q.retries = 0;
      for (const op of batch) op.done(true);
    })
    .catch(async (e: unknown) => {
      if (e instanceof RpcError && e.code === "conflict" && q.retries < MAX_CONFLICT_RETRIES) {
        q.retries++;
        q.known = await q.opts.reread().catch(() => q.known);
        q.again = true;
        return;
      }
      fail(q, t("dashSaveFailed", errorInfo(e).text));
    })
    .finally(() => {
      q.inFlight = false;
      rerender(q);
      if (q.again) {
        q.again = false;
        flush(q);
      }
      prune(o.id);
    });
}

/** Tests: drop every queue (pending timers included), as a fresh page would start. */
export function resetSyncedRecords(): void {
  for (const q of queues.values()) clearTimeout(q.timer);
  queues.clear();
}

export function useSyncedRecord<V>(opts: SyncedRecordOptions<V>) {
  const [, setTick] = useState(0);
  const shown = queueFor(opts);
  /** The record's queue now (an idle one may have been dropped and made again meanwhile). */
  const q = (): QueueState<V> =>
    (queues.get(opts.id) as QueueState<V> | undefined) ?? queueFor(opts);

  useEffect(() => {
    const cur = q();
    const listener = () => setTick((n) => n + 1);
    cur.listeners.add(listener);
    const onHide = () => flush(cur);
    addEventListener("pagehide", onHide);
    return () => {
      cur.listeners.delete(listener);
      removeEventListener("pagehide", onHide);
      // Unmount (scope switch, panel collapse): pending edits are written now; failed ones stay
      // queued with their error for the next editor of this record.
      if (cur.timer !== undefined) flush(cur);
      prune(cur.opts.id);
    };
  }, [opts.id]);

  /** Queues an edit; resolves true once the worker has it, false if the user discards it. */
  const apply = (run: (v: V) => V, opt: ApplyOptions<V> = {}): Promise<boolean> =>
    new Promise((done) => {
      const cur = q();
      cur.ops.push({ run, check: opt.check, done });
      rerender(cur);
      clearTimeout(cur.timer);
      cur.timer = undefined;
      // While an error is shown the edit waits for Retry / Discard.
      if (cur.error === null)
        cur.timer = setTimeout(() => flush(cur), opt.immediate ? 0 : cur.opts.delay);
    });

  /** Clears the error and writes the queued edits again (re-reading on conflict as usual). */
  const retry = (): void => {
    const cur = q();
    cur.error = null;
    cur.retries = 0;
    rerender(cur);
    flush(cur);
  };

  /** Drops every queued edit and the error: the stored record shows again. */
  const discard = (): void => {
    const cur = q();
    clearTimeout(cur.timer);
    cur.timer = undefined;
    const dropped = cur.ops.splice(0);
    cur.error = null;
    cur.retries = 0;
    for (const op of dropped) op.done(false);
    rerender(cur);
  };

  const value = shown.ops.reduce((v, op) => op.run(v), base(shown).value);
  return {
    value,
    apply,
    flush: () => flush(q()),
    retry,
    discard,
    pending: shown.ops.length > 0,
    error: shown.error,
  };
}
