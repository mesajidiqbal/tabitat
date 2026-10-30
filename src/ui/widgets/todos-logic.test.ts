import { describe, expect, it } from "vitest";
import type { Todo } from "@/core/model/types";
import {
  addTodo,
  clearDone,
  editTodo,
  moveTodo,
  moveTodoTo,
  removeTodo,
  sortTodos,
  TODO_CAP,
  TODO_MAX_TEXT,
  toggleTodo,
} from "./todos-logic";

const todo = (id: string, order: number, over: Partial<Todo> = {}): Todo => ({
  id,
  text: id.toUpperCase(),
  done: false,
  order,
  createdAt: 1,
  ...over,
});
const ids = (items: Todo[]) => items.map((x) => x.id);
const orders = (items: Todo[]) => items.map((x) => x.order);

describe("todo list helpers", () => {
  it("sortTodos orders by `order` without mutating", () => {
    const input = [todo("b", 5), todo("a", 1)];
    expect(ids(sortTodos(input))).toEqual(["a", "b"]);
    expect(ids(input)).toEqual(["b", "a"]);
  });

  it("sortTodos drops ids the worker would reject", () => {
    expect(ids(sortTodos([todo("ok", 1), todo("bad id", 0), todo("__proto__", 2)]))).toEqual([
      "ok",
    ]);
  });

  it("addTodo appends a trimmed item and renumbers", () => {
    const out = addTodo([todo("a", 3)], "  milk  ", "n1", 42);
    expect(out).toEqual([
      todo("a", 0),
      { id: "n1", text: "milk", done: false, order: 1, createdAt: 42 },
    ]);
  });

  it("addTodo ignores blank text and cuts long text", () => {
    expect(addTodo([], "   ", "x", 1)).toEqual([]);
    expect(addTodo([], "x".repeat(TODO_MAX_TEXT + 50), "x", 1)[0]?.text).toHaveLength(
      TODO_MAX_TEXT,
    );
  });

  it("addTodo stops at the cap", () => {
    const full = Array.from({ length: TODO_CAP }, (_, i) => todo(`t${i}`, i));
    const out = addTodo(full, "one more", "extra", 1);
    expect(out).toHaveLength(TODO_CAP);
    expect(out.some((x) => x.id === "extra")).toBe(false);
    expect(addTodo(full.slice(1), "fits", "ok", 1)).toHaveLength(TODO_CAP);
  });

  it("toggleTodo sets done + doneAt, and back clears doneAt", () => {
    const on = toggleTodo([todo("a", 0)], "a", 99);
    expect(on[0]).toMatchObject({ done: true, doneAt: 99 });
    const off = toggleTodo(on, "a", 100);
    expect(off[0]?.done).toBe(false);
    expect(off[0] && "doneAt" in off[0]).toBe(false);
  });

  it("editTodo replaces text; a blank edit removes the item", () => {
    expect(editTodo([todo("a", 0)], "a", " new ")[0]?.text).toBe("new");
    expect(editTodo([todo("a", 0), todo("b", 1)], "a", "  ")).toEqual([todo("b", 0)]);
  });

  it("removeTodo drops the item and renumbers", () => {
    const out = removeTodo([todo("a", 0), todo("b", 1), todo("c", 2)], "b");
    expect(ids(out)).toEqual(["a", "c"]);
    expect(orders(out)).toEqual([0, 1]);
  });

  it("moveTodo moves by delta, clamped at both ends", () => {
    const list = [todo("a", 0), todo("b", 1), todo("c", 2)];
    expect(ids(moveTodo(list, "a", 1))).toEqual(["b", "a", "c"]);
    expect(ids(moveTodo(list, "c", -1))).toEqual(["a", "c", "b"]);
    expect(ids(moveTodo(list, "a", -1))).toEqual(["a", "b", "c"]);
    expect(ids(moveTodo(list, "c", 5))).toEqual(["a", "b", "c"]);
    expect(ids(moveTodo(list, "zz", 1))).toEqual(["a", "b", "c"]);
    expect(orders(moveTodo(list, "a", 2))).toEqual([0, 1, 2]);
  });

  it("moveTodoTo moves onto the target's position (drag and drop)", () => {
    const list = [todo("a", 0), todo("b", 1), todo("c", 2)];
    expect(ids(moveTodoTo(list, "a", "c"))).toEqual(["b", "c", "a"]);
    expect(ids(moveTodoTo(list, "c", "a"))).toEqual(["c", "a", "b"]);
    expect(ids(moveTodoTo(list, "a", "missing"))).toEqual(["a", "b", "c"]);
  });

  it("clearDone keeps open items in order", () => {
    const list = [todo("a", 0, { done: true }), todo("b", 1), todo("c", 2, { done: true })];
    expect(clearDone(list)).toEqual([todo("b", 0)]);
  });
});
