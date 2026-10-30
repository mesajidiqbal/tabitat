// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Todo } from "@/core/model/types";
import { setTransport } from "@/messaging/client";
import type { RpcRequest } from "@/messaging/commands";
import { store } from "../store";
import { Todos } from "./Todos";

type SetPayload = { scope: string; items: Todo[]; expectedRev?: number };
let sets: SetPayload[] = [];

beforeEach(() => {
  sets = [];
  store.todos.value = { global: { items: [], rev: 0 } };
  setTransport(async (msg: RpcRequest) => {
    if (msg.type !== "todo.set") return { ok: false, code: "invalid", message: "unexpected" };
    const p = msg.payload as SetPayload;
    sets.push(p);
    return { ok: true, value: { rev: (p.expectedRev ?? 0) + 1 } };
  });
});

afterEach(() => {
  cleanup();
  setTransport(null);
  store.todos.value = {};
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
    expect((addInput() as HTMLInputElement).value).toBe("");
    await waitFor(() => expect(sets).toHaveLength(1));
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
    store.todos.value = {
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
    const first = screen.getAllByRole("listitem")[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowDown", altKey: true });
    expect(rowTexts()).toEqual(["two", "one", "three"]);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("one"));
    await waitFor(() => expect(sets).toHaveLength(1));
    expect(sets[0]?.expectedRev).toBe(4);
    expect(sets[0]?.items.map((x) => [x.id, x.order])).toEqual([
      ["t1", 0],
      ["t0", 1],
      ["t2", 2],
    ]);
  });
});
