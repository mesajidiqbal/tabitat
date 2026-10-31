/**
 * Todos widget (docs/PHASE4.md §4): scope switch, add (Enter), toggle, edit, delete, reorder
 * (drag or Alt+↑↓), "Clear done"; cap 500 per list. Writes `todo.set` (whole list, expectedRev),
 * rapid edits coalesced over 250 ms (useSyncedRecord).
 */
import { useId, useRef, useState } from "preact/hooks";
import { newId } from "@/core/model/id";
import { Keys, type Scope, type Todo } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import { useRoving } from "../hooks/useRoving";
import { Card, SaveError, ScopeSwitch, Skeleton, useScope, type WidgetProps } from "./Card";
import { records, sanitizeTodoList } from "./records";
import { TodoRow } from "./TodoRow";
import {
  addBlocked,
  addTodo,
  clearDone,
  editTodo,
  moveTodo,
  moveTodoTo,
  removeTodo,
  setDone,
  sortTodos,
  TODO_CAP,
} from "./todos-logic";
import { useSyncedRecord } from "./useSyncedRecord";
import s from "./widgets.module.css";

const EMPTY = { items: [] as Todo[], rev: 0 };
const COALESCE_MS = 250;

export function Todos({ compact }: WidgetProps) {
  const sc = useScope();
  const loaded = sc.scope in records.todos.value;
  return (
    <Card
      id="todos"
      title={t("dashTodos")}
      compact={compact}
      actions={<ScopeSwitch {...sc} label={t("dashScopeLabel")} />}
    >
      {loaded ? <TodoList key={sc.scope} scope={sc.scope} /> : <Skeleton small />}
    </Card>
  );
}

function TodoList({ scope }: { scope: Scope }) {
  const stored = records.todos.value[scope] ?? EMPTY;
  const rec = useSyncedRecord<Todo[]>({
    id: Keys.todos(scope),
    stored: { value: stored.items, rev: stored.rev },
    write: (items, expectedRev) =>
      send("todo.set", { scope, items, expectedRev }).then((r) => r.rev),
    reread: async () => {
      const k = Keys.todos(scope);
      const l = sanitizeTodoList((await chrome.storage.local.get(k))[k]);
      return { value: l.items, rev: l.rev };
    },
    delay: COALESCE_MS,
  });
  const items = sortTodos(rec.value);
  const [text, setTextState] = useState("");
  const textRef = useRef("");
  const setText = (v: string) => {
    textRef.current = v;
    setTextState(v);
  };
  /** The add waiting for its acknowledgement (a repeated Enter does not add it twice). */
  const adding = useRef<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const addRef = useRef<HTMLInputElement>(null);
  // The last todo went (deleted, cleared): focus the add box, the list's primary control (C2.3).
  const roving = useRoving(items.length, { onEmpty: () => addRef.current?.focus() });
  const hintId = useId();
  const full = items.length >= TODO_CAP;
  const doneCount = items.filter((x) => x.done).length;
  const refocus = (i: number) => setTimeout(() => roving.focusAt(i));

  const onAddKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const value = (e.currentTarget as HTMLInputElement).value;
    if (value.trim() === "" || full || adding.current === value) return;
    const [id, now] = [newId(), Date.now()];
    adding.current = value;
    // The text stays in the box until the worker has the item (C-B2): a failed or "list full"
    // add keeps it for another try.
    void rec
      .apply((v) => addTodo(v, value, id, now), {
        immediate: true,
        check: (v) => (addBlocked(v) ? t("dashTodoListFull", TODO_CAP) : null),
      })
      .then((written) => {
        if (adding.current === value) adding.current = null;
        if (written && textRef.current === value) setText("");
      });
  };

  return (
    <>
      <input
        ref={addRef}
        class={c.input}
        aria-label={t("dashTodoAdd")}
        placeholder={full ? t("dashTodoFull", TODO_CAP) : t("dashTodoAdd")}
        disabled={full}
        maxLength={1000}
        enterKeyHint="done"
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onKeyDown={onAddKey}
      />
      <SaveError text={rec.error} onRetry={rec.retry} onDiscard={rec.discard} />
      <p id={hintId} class="sr-only">
        {t("dashTodoKeysHint")}
      </p>
      {items.length === 0 ? (
        <EmptyState title={t("dashTodoEmpty")} hint={t("dashTodoEmptyHint")} />
      ) : (
        <ul class={s.list} aria-label={t("dashTodos")}>
          {items.map((todo, i) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              item={roving.item(i)}
              hintId={hintId}
              onToggle={(done) => {
                const now = Date.now();
                void rec.apply((v) => setDone(v, todo.id, done, now));
              }}
              onEdit={(value) => void rec.apply((v) => editTodo(v, todo.id, value))}
              onDelete={() => {
                void rec.apply((v) => removeTodo(v, todo.id));
                refocus(Math.min(i, items.length - 2));
              }}
              onMove={(delta) => {
                void rec.apply((v) => moveTodo(v, todo.id, delta));
                refocus(i + delta);
              }}
              drag={{
                over: drag?.over === todo.id && drag.id !== todo.id,
                onStart: () => setDrag({ id: todo.id, over: null }),
                onOver: () => drag && drag.over !== todo.id && setDrag({ ...drag, over: todo.id }),
                onDrop: () => {
                  const from = drag?.id;
                  if (from && from !== todo.id) void rec.apply((v) => moveTodoTo(v, from, todo.id));
                  setDrag(null);
                },
                onEnd: () => setDrag(null),
              }}
            />
          ))}
        </ul>
      )}
      {doneCount > 0 && (
        <div class={s.row}>
          <span class={`${s.muted} ${s.grow}`}>
            {plural(items.length - doneCount, "dashTodoLeftOne", "dashTodoLeftMany")}
          </span>
          <button
            type="button"
            class={`${c.btn} ${c.ghost}`}
            onClick={() => void rec.apply(clearDone)}
          >
            {t("dashTodoClearDone")}
          </button>
        </div>
      )}
    </>
  );
}
