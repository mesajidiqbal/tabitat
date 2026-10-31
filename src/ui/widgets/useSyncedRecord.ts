/**
 * Local edits over a revisioned worker record (todo lists, quick links). Edits are pure ops kept
 * until the worker acknowledges them and shown applied over the latest known record, so a change
 * from another surface rebases them. Rapid edits coalesce into one write after `delay` ms (whole
 * value, `expectedRev`). A `conflict` re-reads storage and replays the ops on the fresh record
 * (at most 3 times). When the retries run out, another error comes back, or an op cannot apply
 * on the replayed record (e.g. the list filled up elsewhere), the ops stay queued and `error`
 * says why until the user picks `retry()` or `discard()` (review C-B2 / C-U3).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { t } from "@/i18n";
import { RpcError } from "@/messaging/errors";
import { errorInfo } from "../actions";

export interface Versioned<V> {
  value: V;
  rev: number;
}

export interface SyncedRecordOptions<V> {
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

const MAX_CONFLICT_RETRIES = 3;

export function useSyncedRecord<V>(opts: SyncedRecordOptions<V>) {
  const [, setTick] = useState(0);
  const o = useRef(opts);
  o.current = opts;
  const ops = useRef<Array<PendingOp<V>>>([]);
  /** Our last acknowledged write (or a fresh read): shown until the store catches up. */
  const known = useRef<Versioned<V> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inFlight = useRef(false);
  const again = useRef(false);
  const retries = useRef(0);
  const error = useRef<string | null>(null);
  const alive = useRef(true);
  const rerender = () => alive.current && setTick((n) => n + 1);

  const base = (): Versioned<V> => {
    const k = known.current;
    return k && k.rev > o.current.stored.rev ? k : o.current.stored;
  };

  const fail = (text: string) => {
    retries.current = 0;
    error.current = text;
    rerender();
  };

  const flush = (): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (ops.current.length === 0 || error.current !== null) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const batch = ops.current.slice();
    const b = base();
    let next = b.value;
    for (const op of batch) {
      const why = op.check?.(next) ?? null;
      if (why !== null) {
        fail(why);
        return;
      }
      next = op.run(next);
    }
    inFlight.current = true;
    o.current
      .write(next, b.rev)
      .then((rev) => {
        known.current = { value: next, rev };
        ops.current.splice(0, batch.length);
        retries.current = 0;
        for (const op of batch) op.done(true);
      })
      .catch(async (e: unknown) => {
        if (
          e instanceof RpcError &&
          e.code === "conflict" &&
          retries.current < MAX_CONFLICT_RETRIES
        ) {
          retries.current++;
          known.current = await o.current.reread().catch(() => known.current);
          again.current = true;
          return;
        }
        fail(t("dashSaveFailed", errorInfo(e).text));
      })
      .finally(() => {
        inFlight.current = false;
        rerender();
        if (again.current) {
          again.current = false;
          flush();
        }
      });
  };

  /** Queues an edit; resolves true once the worker has it, false if the user discards it. */
  const apply = (run: (v: V) => V, opt: ApplyOptions<V> = {}): Promise<boolean> =>
    new Promise((done) => {
      ops.current.push({ run, check: opt.check, done });
      rerender();
      clearTimeout(timer.current);
      timer.current = undefined;
      // While an error is shown the edit waits for Retry / Discard.
      if (error.current === null)
        timer.current = setTimeout(flush, opt.immediate ? 0 : o.current.delay);
    });

  /** Clears the error and writes the queued edits again (re-reading on conflict as usual). */
  const retry = (): void => {
    error.current = null;
    retries.current = 0;
    rerender();
    flush();
  };

  /** Drops every queued edit and the error: the stored record shows again. */
  const discard = (): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const dropped = ops.current.splice(0);
    error.current = null;
    retries.current = 0;
    for (const op of dropped) op.done(false);
    rerender();
  };

  useEffect(() => {
    alive.current = true;
    const onHide = () => flush();
    addEventListener("pagehide", onHide);
    return () => {
      alive.current = false;
      removeEventListener("pagehide", onHide);
      // Unmount (scope switch, panel collapse): pending edits are written now.
      if (timer.current !== undefined) flush();
    };
  }, []);

  const value = ops.current.reduce((v, op) => op.run(v), base().value);
  return {
    value,
    apply,
    flush,
    retry,
    discard,
    pending: ops.current.length > 0,
    error: error.current,
  };
}
