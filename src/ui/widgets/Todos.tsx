/**
 * Todos widget (docs/PHASE4.md §4): scope switch, add (Enter), toggle, edit, delete, reorder
 * (drag or Alt+↑↓), "Clear done"; cap 500 per list. Writes `todo.set` (whole list, expectedRev),
 * rapid edits coalesced over 250 ms (useSyncedRecord).
 */
import { useState } from "preact/hooks";
import { newId } from "@/core/model/id";
import { Keys, type Scope, type Todo } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import c from "../components/controls.module.css";
import { EmptyState } from "../components/EmptyState";
import { useRoving } from "../hooks/useRoving";
import { sanitizeTodoList } from "../sanitize";
import { store } from "../store";
import { Card, ScopeSwitch, Skeleton, useScope, type WidgetProps } from "./Card";
import { TodoRow } from "./TodoRow";
import {
  addTodo,
  clearDone,
  editTodo,
  moveTodo,
  moveTodoTo,
  removeTodo,
  sortTodos,
  TODO_CAP,
  toggleTodo,
} from "./todos-logic";
import { useSyncedRecord } from "./useSyncedRecord";
import s from "./widgets.module.css";

const EMPTY = { items: [] as Todo[], rev: 0 };
const COALESCE_MS = 250;

export function Todos({ compact }: WidgetProps) {
  const sc = useScope();
  const loaded = sc.scope in store.todos.value;
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
  const stored = store.todos.value[scope] ?? EMPTY;
  const rec = useSyncedRecord<Todo[]>({
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
  const [text, setText] = useState("");
  const [drag, setDrag] = useState<{ id: string; over: string | null } | null>(null);
  const roving = useRoving(items.length);
  const full = items.length >= TODO_CAP;
  const doneCount = items.filter((x) => x.done).length;
  const refocus = (i: number) => setTimeout(() => roving.focusAt(i));

  const onAddKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    const value = (e.currentTarget as HTMLInputElement).value;
    if (value.trim() === "" || full) return;
    const [id, now] = [newId(), Date.now()];
    rec.apply((v) => addTodo(v, value, id, now));
    setText("");
  };

  return (
    <>
      <input
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
      {items.length === 0 ? (
        <EmptyState title={t("dashTodoEmpty")} hint={t("dashTodoEmptyHint")} />
      ) : (
        <ul class={s.list} aria-label={t("dashTodos")}>
          {items.map((todo, i) => (
            <TodoRow
              key={todo.id}
              todo={todo}
              item={roving.item(i)}
              onToggle={() => {
                const now = Date.now();
                rec.apply((v) => toggleTodo(v, todo.id, now));
              }}
              onEdit={(value) => rec.apply((v) => editTodo(v, todo.id, value))}
              onDelete={() => {
                rec.apply((v) => removeTodo(v, todo.id));
                refocus(Math.min(i, items.length - 2));
              }}
              onMove={(delta) => {
                rec.apply((v) => moveTodo(v, todo.id, delta));
                refocus(i + delta);
              }}
              drag={{
                over: drag?.over === todo.id && drag.id !== todo.id,
                onStart: () => setDrag({ id: todo.id, over: null }),
                onOver: () => drag && drag.over !== todo.id && setDrag({ ...drag, over: todo.id }),
                onDrop: () => {
                  const from = drag?.id;
                  if (from && from !== todo.id) rec.apply((v) => moveTodoTo(v, from, todo.id));
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
          <button type="button" class={`${c.btn} ${c.ghost}`} onClick={() => rec.apply(clearDone)}>
            {t("dashTodoClearDone")}
          </button>
        </div>
      )}
    </>
  );
}
