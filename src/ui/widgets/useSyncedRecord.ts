/**
 * Local edits over a revisioned worker record (todo lists, quick links). Edits are pure ops kept
 * until the worker acknowledges them and shown applied over the latest known record, so a change
 * from another surface rebases them. Rapid edits coalesce into one write after `delay` ms (whole
 * value, `expectedRev`). A `conflict` re-reads storage and replays the ops on the fresh record
 * (at most 3 times); any other failure drops them and shows the inline error line.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { RpcError } from "@/messaging/errors";
import { errorInfo, uiError } from "../actions";

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

const MAX_CONFLICT_RETRIES = 3;

export function useSyncedRecord<V>(opts: SyncedRecordOptions<V>) {
  const [, setTick] = useState(0);
  const o = useRef(opts);
  o.current = opts;
  const ops = useRef<Array<(v: V) => V>>([]);
  /** Our last acknowledged write (or a fresh read): shown until the store catches up. */
  const known = useRef<Versioned<V> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const inFlight = useRef(false);
  const again = useRef(false);
  const retries = useRef(0);
  const alive = useRef(true);
  const rerender = () => alive.current && setTick((n) => n + 1);

  const base = (): Versioned<V> => {
    const k = known.current;
    return k && k.rev > o.current.stored.rev ? k : o.current.stored;
  };

  const flush = (): void => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (ops.current.length === 0) return;
    if (inFlight.current) {
      again.current = true;
      return;
    }
    const n = ops.current.length;
    const b = base();
    const next = ops.current.reduce((v, op) => op(v), b.value);
    inFlight.current = true;
    o.current
      .write(next, b.rev)
      .then((rev) => {
        known.current = { value: next, rev };
        ops.current.splice(0, n);
        retries.current = 0;
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
        retries.current = 0;
        ops.current.splice(0, n);
        uiError.value = errorInfo(e);
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

  const apply = (op: (v: V) => V): void => {
    ops.current.push(op);
    rerender();
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, o.current.delay);
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

  const value = ops.current.reduce((v, op) => op(v), base().value);
  return { value, apply, flush, pending: ops.current.length > 0 };
}
