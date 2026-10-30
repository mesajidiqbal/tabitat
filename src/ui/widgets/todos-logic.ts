/**
 * Pure todo-list edits (docs/PHASE4.md §4 Todos). Every helper returns a new array ordered by
 * position with `order` renumbered 0..n-1, so the list written back is always canonical.
 */
import { isValidId } from "@/core/model/id";
import type { Todo } from "@/core/model/types";

/** Items per list. */
export const TODO_CAP = 500;
/** Longest todo text kept (longer input is cut). */
export const TODO_MAX_TEXT = 1000;

const renumber = (items: Todo[]): Todo[] =>
  items.map((x, i) => (x.order === i ? x : { ...x, order: i }));

/** Items by `order` (stable for ties), without ids the worker would reject. */
export function sortTodos(items: readonly Todo[]): Todo[] {
  return items.filter((x) => isValidId(x.id)).sort((a, b) => a.order - b.order);
}

/** Appends a todo; unchanged when the text is blank or the list is at the cap. */
export function addTodo(items: readonly Todo[], text: string, id: string, now: number): Todo[] {
  const clean = text.trim().slice(0, TODO_MAX_TEXT);
  const list = sortTodos(items);
  if (clean === "" || list.length >= TODO_CAP) return list;
  return renumber([...list, { id, text: clean, done: false, order: list.length, createdAt: now }]);
}

export function toggleTodo(items: readonly Todo[], id: string, now: number): Todo[] {
  return renumber(
    sortTodos(items).map((x) => {
      if (x.id !== id) return x;
      if (x.done) {
        const { doneAt: _drop, ...rest } = x;
        return { ...rest, done: false };
      }
      return { ...x, done: true, doneAt: now };
    }),
  );
}

/** Replaces the text; a blank edit removes the item. */
export function editTodo(items: readonly Todo[], id: string, text: string): Todo[] {
  const clean = text.trim().slice(0, TODO_MAX_TEXT);
  if (clean === "") return removeTodo(items, id);
  return renumber(sortTodos(items).map((x) => (x.id === id ? { ...x, text: clean } : x)));
}

export function removeTodo(items: readonly Todo[], id: string): Todo[] {
  return renumber(sortTodos(items).filter((x) => x.id !== id));
}

/** Moves an item `delta` places (clamped); unchanged when it is missing. */
export function moveTodo(items: readonly Todo[], id: string, delta: number): Todo[] {
  const list = sortTodos(items);
  const from = list.findIndex((x) => x.id === id);
  if (from < 0) return renumber(list);
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  const [item] = list.splice(from, 1);
  if (item) list.splice(to, 0, item);
  return renumber(list);
}

/** Moves `id` to the position of `targetId` (drag and drop). */
export function moveTodoTo(items: readonly Todo[], id: string, targetId: string): Todo[] {
  const list = sortTodos(items);
  const from = list.findIndex((x) => x.id === id);
  const to = list.findIndex((x) => x.id === targetId);
  if (from < 0 || to < 0) return renumber(list);
  return moveTodo(list, id, to - from);
}

export function clearDone(items: readonly Todo[]): Todo[] {
  return renumber(sortTodos(items).filter((x) => !x.done));
}
