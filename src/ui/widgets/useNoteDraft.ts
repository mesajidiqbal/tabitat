/**
 * Note draft over `notes:<scope>` (docs/PHASE4.md §4 Notes). Typing keeps a local draft and saves
 * it 500 ms after the last keystroke (`note.set`, expectedRev = the rev the draft started from).
 * A `conflict` never loses the draft: it stays in the textarea and `conflict` is set until the
 * user picks Reload (take the stored note) or Keep mine (overwrite it).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { Keys, type Note, type Scope } from "@/core/model/types";
import { send } from "@/messaging/client";
import { RpcError } from "@/messaging/errors";
import { errorInfo, uiError } from "../actions";
import { sanitizeNote } from "../sanitize";
import { store } from "../store";

export const NOTE_SAVE_MS = 500;
const EMPTY: Note = { content: "", updatedAt: 0, rev: 0 };

export function useNoteDraft(scope: Scope) {
  const stored = store.notes.value[scope] ?? EMPTY;
  const [draft, setDraftState] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const draftRef = useRef<string | null>(null);
  /** Our last saved note (or a fresh read): shown until the store catches up. */
  const known = useRef<Note | null>(null);
  const baseRev = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const saving = useRef(false);
  const again = useRef(false);
  const conflictRef = useRef(false);
  const alive = useRef(true);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const latest = (): Note => {
    const k = known.current;
    return k && k.rev > storedRef.current.rev ? k : storedRef.current;
  };
  const setDraft = (v: string | null) => {
    draftRef.current = v;
    if (alive.current) setDraftState(v);
  };
  const markConflict = (on: boolean) => {
    conflictRef.current = on;
    if (alive.current) setConflict(on);
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
    const content = draftRef.current;
    if (content === null || conflictRef.current) return;
    if (saving.current) {
      again.current = true;
      return;
    }
    saving.current = true;
    try {
      const out = await send("note.set", { scope, content, expectedRev: baseRev.current });
      known.current = out;
      baseRev.current = out.rev;
      if (draftRef.current === content) setDraft(null);
    } catch (e) {
      if (e instanceof RpcError && e.code === "conflict") markConflict(true);
      else uiError.value = errorInfo(e);
    } finally {
      saving.current = false;
      if (again.current) {
        again.current = false;
        void save();
      }
    }
  };

  const onInput = (text: string) => {
    if (draftRef.current === null) baseRev.current = latest().rev;
    setDraft(text);
    clearTimeout(timer.current);
    if (!conflictRef.current) timer.current = setTimeout(() => void save(), NOTE_SAVE_MS);
  };

  /** Drops the draft and shows the stored note. */
  const reload = async () => {
    await readStored().catch(() => undefined);
    markConflict(false);
    setDraft(null);
  };

  /** Overwrites the stored note with the draft. */
  const keepMine = async () => {
    const cur = await readStored().catch(() => latest());
    baseRev.current = cur.rev;
    markConflict(false);
    await save();
  };

  useEffect(() => {
    alive.current = true;
    const onHide = () => void save();
    addEventListener("pagehide", onHide);
    return () => {
      alive.current = false;
      removeEventListener("pagehide", onHide);
      if (timer.current !== undefined) void save();
    };
  }, []);

  return {
    text: draft ?? latest().content,
    dirty: draft !== null,
    conflict,
    onInput,
    reload,
    keepMine,
  };
}
