import { describe, expect, it } from "vitest";
import type { Todo } from "@/core/model/types";
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
  TODO_MAX_TEXT,
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

  it("setDone sets done + doneAt, and back clears doneAt", () => {
    const on = setDone([todo("a", 0)], "a", true, 99);
    expect(on[0]).toMatchObject({ done: true, doneAt: 99 });
    const off = setDone(on, "a", false, 100);
    expect(off[0]?.done).toBe(false);
    expect(off[0] && "doneAt" in off[0]).toBe(false);
  });

  it("setDone is idempotent: two checks from different bases converge (C-B3)", () => {
    const base = [todo("a", 0)];
    // Surface A checks the item and its write lands first.
    const a = setDone(base, "a", true, 10);
    // Surface B also checked it from the same base; its op is replayed over A's result.
    const b = setDone(a, "a", true, 20);
    expect(b[0]).toMatchObject({ done: true, doneAt: 10 });
    // A then unchecks while B's replayed "check" was based on the unchecked list: last wins.
    const c = setDone(setDone(b, "a", false, 30), "a", false, 31);
    expect(c[0]?.done).toBe(false);
    expect(setDone(c, "missing", true, 1)).toEqual(c);
  });

  it("addBlocked is true at the cap only", () => {
    const full = Array.from({ length: TODO_CAP }, (_, i) => todo(`t${i}`, i));
    expect(addBlocked(full)).toBe(true);
    expect(addBlocked(full.slice(1))).toBe(false);
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
