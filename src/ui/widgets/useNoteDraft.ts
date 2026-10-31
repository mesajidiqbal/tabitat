/**
 * Note draft over `notes:<scope>` (docs/PHASE4.md §4 Notes). Typing keeps a draft and saves it
 * 500 ms after the last keystroke (`note.set`, expectedRev = the rev the draft started from).
 * The draft lives in the per-scope store (noteDrafts.ts), not in the component, so it survives
 * unmount and reload. A `conflict` never loses it: it stays, flagged, until the user picks
 * Reload (take the stored note) or Keep mine (overwrite it); a remount shows the notice again.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { Keys, type Note, type Scope } from "@/core/model/types";
import { send } from "@/messaging/client";
import { RpcError } from "@/messaging/errors";
import { errorInfo, uiError } from "../actions";
import { getNoteDraft, type NoteDraft, setNoteDraft } from "./noteDrafts";
import { records, sanitizeNote } from "./records";

export const NOTE_SAVE_MS = 500;
const EMPTY: Note = { content: "", updatedAt: 0, rev: 0 };

/** Scopes with a note.set in flight / a save requested meanwhile (shared by every editor). */
const saving = new Set<Scope>();
const again = new Set<Scope>();

export function useNoteDraft(scope: Scope) {
  const stored = records.notes.value[scope] ?? EMPTY;
  const [, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  /** Our last saved note (or a fresh read): shown until the store catches up. */
  const known = useRef<Note | null>(null);
  const alive = useRef(true);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const latest = (): Note => {
    const k = known.current;
    return k && k.rev > storedRef.current.rev ? k : storedRef.current;
  };
  const update = (d: NoteDraft | null) => {
    setNoteDraft(scope, d);
    if (alive.current) setTick((n) => n + 1);
  };
  const readStored = async (): Promise<Note> => {
    const k = Keys.notes(scope);
    const note = sanitizeNote((await chrome.storage.local.get(k))[k]);
    if (note.rev >= latest().rev) known.current = note;
    return note;
  };

  const save = async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = getNoteDraft(scope);
    if (!d || d.conflict) return;
    if (saving.has(scope)) {
      again.add(scope);
      return;
    }
    saving.add(scope);
    try {
      const out = await send("note.set", { scope, content: d.content, expectedRev: d.baseRev });
      known.current = out;
      const cur = getNoteDraft(scope);
      if (cur && cur.content === d.content) update(null);
      else if (cur) update({ ...cur, baseRev: out.rev });
    } catch (e) {
      const cur = getNoteDraft(scope);
      if (e instanceof RpcError && e.code === "conflict") {
        if (cur) update({ ...cur, conflict: true });
      } else uiError.value = errorInfo(e);
    } finally {
      saving.delete(scope);
      if (again.delete(scope)) void save();
    }
  };

  const onInput = (text: string) => {
    const cur = getNoteDraft(scope);
    const conflict = cur?.conflict ?? false;
    update({ content: text, baseRev: cur ? cur.baseRev : latest().rev, conflict });
    clearTimeout(timer.current);
    timer.current = conflict ? undefined : setTimeout(() => void save(), NOTE_SAVE_MS);
  };

  /** Drops the draft and shows the stored note. */
  const reload = async () => {
    await readStored().catch(() => undefined);
    update(null);
  };

  /** Overwrites the stored note with the draft. */
  const keepMine = async () => {
    const cur = await readStored().catch(() => latest());
    const d = getNoteDraft(scope);
    if (d) update({ ...d, baseRev: cur.rev, conflict: false });
    await save();
  };

  useEffect(() => {
    alive.current = true;
    // A clean draft restored from an earlier editor (or a reload) is saved again, unless the
    // stored note already has its text. A conflicted one waits for the user.
    const d = getNoteDraft(scope);
    if (d && !d.conflict) {
      if (d.content === latest().content) update(null);
      else timer.current = setTimeout(() => void save(), NOTE_SAVE_MS);
    }
    const onHide = () => void save();
    addEventListener("pagehide", onHide);
    return () => {
      alive.current = false;
      removeEventListener("pagehide", onHide);
      // Unmount: a clean pending draft is written now; a conflicted one stays in noteDrafts.
      if (timer.current !== undefined) void save();
    };
  }, []);

  const draft = getNoteDraft(scope);
  return {
    text: draft?.content ?? latest().content,
    dirty: draft !== null,
    conflict: draft?.conflict ?? false,
    onInput,
    reload,
    keepMine,
  };
}
