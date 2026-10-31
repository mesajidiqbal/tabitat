// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Todo } from "@/core/model/types";
import { setTransport } from "@/messaging/client";
import type { RpcRequest } from "@/messaging/commands";
import { records } from "./records";
import { Todos } from "./Todos";

type SetPayload = { scope: string; items: Todo[]; expectedRev?: number };
let sets: SetPayload[] = [];
/** Error code the fake worker answers todo.set with (null: success). */
let failWith: string | null = null;

beforeEach(() => {
  sets = [];
  failWith = null;
  records.todos.value = { global: { items: [], rev: 0 } };
  setTransport(async (msg: RpcRequest) => {
    if (msg.type !== "todo.set") return { ok: false, code: "invalid", message: "unexpected" };
    const p = msg.payload as SetPayload;
    sets.push(p);
    if (failWith) return { ok: false, code: failWith, message: "nope", retryable: false };
    return { ok: true, value: { rev: (p.expectedRev ?? 0) + 1 } };
  });
});

afterEach(() => {
  cleanup();
  setTransport(null);
  vi.unstubAllGlobals();
  records.todos.value = {};
});

const addInput = () => screen.getByRole("textbox", { name: "Add a task" });
const add = (text: string) => {
  fireEvent.input(addInput(), { target: { value: text } });
  fireEvent.keyDown(addInput(), { key: "Enter" });
};
const rowTexts = () => screen.getAllByRole("listitem").map((li) => li.textContent);

describe("Todos (DOM)", () => {
  it("Enter adds a todo; rapid adds coalesce into one todo.set with expectedRev", async () => {
    render(<Todos />);
    expect(screen.getByText("Nothing to do.")).toBeTruthy();
    add("Buy milk");
    add("Call Bob");
    expect(rowTexts()).toEqual(["Buy milk", "Call Bob"]);
    // The box is cleared once the worker has acknowledged the add (C-B2).
    await waitFor(() => expect((addInput() as HTMLInputElement).value).toBe(""));
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ scope: "global", expectedRev: 0 });
    expect(sets[0]?.items.map((x) => [x.text, x.order, x.done])).toEqual([
      ["Buy milk", 0, false],
      ["Call Bob", 1, false],
    ]);
  });

  it("blank input adds nothing", async () => {
    render(<Todos />);
    add("   ");
    await new Promise((r) => setTimeout(r, 300));
    expect(sets).toHaveLength(0);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("the checkbox toggles done (written on top of the acknowledged rev)", async () => {
    render(<Todos />);
    add("Buy milk");
    await waitFor(() => expect(sets).toHaveLength(1));
    const box = screen.getByRole("checkbox", { name: "Done: Buy milk" }) as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    await waitFor(() => expect(sets).toHaveLength(2));
    expect(sets[1]?.expectedRev).toBe(1);
    expect(sets[1]?.items[0]).toMatchObject({ text: "Buy milk", done: true });
    expect(typeof sets[1]?.items[0]?.doneAt).toBe("number");
    expect(screen.getByRole("button", { name: "Clear done" })).toBeTruthy();
  });

  it("Alt+ArrowDown moves the focused todo down and keeps focus on it", async () => {
    records.todos.value = {
      global: {
        rev: 4,
        items: ["one", "two", "three"].map((text, order) => ({
          id: `t${order}`,
          text,
          done: false,
          order,
          createdAt: 1,
        })),
      },
    };
    render(<Todos />);
    const first = screen.getByRole("checkbox", { name: "Done: one" });
    expect(first.getAttribute("tabindex")).toBe("0");
    expect(first.getAttribute("aria-keyshortcuts")).toContain("F2");
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", altKey: true });
    expect(rowTexts()).toEqual(["two", "one", "three"]);
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Done: one"),
    );
    await waitFor(() => expect(sets).toHaveLength(1));
    expect(sets[0]?.expectedRev).toBe(4);
    expect(sets[0]?.items.map((x) => [x.id, x.order])).toEqual([
      ["t1", 0],
      ["t0", 1],
      ["t2", 2],
    ]);
  });

  it("a failed write keeps the edit and the typed text; Retry writes it (C-B2)", async () => {
    failWith = "internal";
    render(<Todos />);
    add("Buy milk");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Not saved: Something went wrong.");
    expect(rowTexts()).toEqual(["Buy milk"]);
    expect((addInput() as HTMLInputElement).value).toBe("Buy milk");
    // Edits made while the error shows wait for Retry.
    fireEvent.click(screen.getByRole("checkbox", { name: "Done: Buy milk" }));
    await new Promise((r) => setTimeout(r, 300));
    expect(sets).toHaveLength(1);
    failWith = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(sets).toHaveLength(2));
    expect(sets[1]?.items.map((x) => [x.text, x.done])).toEqual([["Buy milk", true]]);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    await waitFor(() => expect((addInput() as HTMLInputElement).value).toBe(""));
  });

  it("Discard drops the failed edits and the error", async () => {
    failWith = "limit";
    render(<Todos />);
    add("Buy milk");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    expect(sets).toHaveLength(1);
    // The text was never saved, so it is still there to try again.
    expect((addInput() as HTMLInputElement).value).toBe("Buy milk");
  });

  it("an add replayed onto a list filled elsewhere reports “list full” and keeps the text", async () => {
    const items = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        text: `item ${i}`,
        done: false,
        order: i,
        createdAt: 1,
      }));
    records.todos.value = { global: { items: items(499), rev: 1 } };
    failWith = "conflict";
    vi.stubGlobal("chrome", {
      storage: { local: { get: async () => ({ "todos:global": { items: items(500), rev: 2 } }) } },
    });
    render(<Todos />);
    add("one more");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Not added: the list is full (500 tasks).");
    expect(sets).toHaveLength(1);
    expect((addInput() as HTMLInputElement).value).toBe("one more");
  });
});
