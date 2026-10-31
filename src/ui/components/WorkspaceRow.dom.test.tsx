// @vitest-environment happy-dom
// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceMeta } from "@/core/model/types";

const switchTo = vi.hoisted(() => vi.fn(async () => true));
const deleteWorkspace = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../actions", async (orig) => ({
  ...(await orig<typeof import("../actions")>()),
  switchTo,
  deleteWorkspace,
}));

import { setTransport } from "@/messaging/client";
import type { RpcRequest } from "@/messaging/commands";
import { useRoving } from "../hooks/useRoving";
import { WorkspaceRow } from "./WorkspaceRow";

const meta = (id: string, name: string): WorkspaceMeta => ({
  id,
  name,
  color: "blue",
  kind: "named",
  resources: [],
  createdAt: 0,
  updatedAt: 0,
  rev: 1,
});
const METAS = [meta("a", "Alpha"), meta("b", "Beta"), meta("c", "Gamma")];

function Grid({
  card = false,
  cols,
  metas = METAS,
}: {
  card?: boolean;
  cols?: number;
  metas?: WorkspaceMeta[];
}) {
  const roving = useRoving(metas.length, cols === undefined ? {} : { columns: () => cols });
  return (
    <div role="grid" aria-label="Workspaces" aria-rowcount={metas.length}>
      {metas.map((m, i) => (
        <WorkspaceRow
          key={m.id}
          meta={m}
          item={roving.item(i)}
          rowIndex={i + 1}
          active={i === 0}
          elsewhere={false}
          tabCount={2}
          shortcut={i + 1}
          disabled={false}
          card={card}
        />
      ))}
    </div>
  );
}

const rows = () => screen.getAllByRole("row");
const primary = (i: number) =>
  rows()[i]?.querySelector<HTMLElement>(':scope > [role="gridcell"]') as HTMLElement;
const actionsBtn = (i: number) =>
  rows()[i]?.querySelector<HTMLElement>('[data-cell="actions"] button') as HTMLElement;
const key = (k: string, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(document.activeElement as HTMLElement, { key: k, ...init });

beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getURL: (p: string) => `chrome-extension://x${p}` } });
  switchTo.mockClear();
  deleteWorkspace.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setTransport(null);
});

describe("WorkspaceRow grid", () => {
  it("renders rows with a primary cell and an Actions cell; the active one is selected", () => {
    render(<Grid />);
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(rows().map((r) => r.getAttribute("aria-rowindex"))).toEqual(["1", "2", "3"]);
    const cells = rows()[1]?.querySelectorAll(':scope > [role="gridcell"]') ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[1]?.getAttribute("aria-description")).toBe("Actions");
    expect(cells[1]?.hasAttribute("aria-label")).toBe(false);
    expect(primary(1).getAttribute("aria-keyshortcuts")).toBe("2 F2 Delete Shift+F10 ContextMenu");
    expect(primary(0).tabIndex).toBe(0);
    expect(primary(1).tabIndex).toBe(-1);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("ArrowRight focuses the menu button, ArrowLeft returns to the primary cell", () => {
    render(<Grid />);
    primary(1).focus();
    key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Actions for Beta");
    key("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Actions for Beta");
    key("ArrowLeft");
    expect(document.activeElement).toBe(primary(1));
    expect(switchTo).not.toHaveBeenCalled();
  });

  it("ArrowUp / ArrowDown / Home / End move rows from the primary cell and the actions cell", () => {
    render(<Grid />);
    primary(0).focus();
    key("ArrowDown");
    expect(document.activeElement).toBe(primary(1));
    key("End");
    expect(document.activeElement).toBe(primary(2));
    key("Home");
    expect(document.activeElement).toBe(primary(0));
    key("ArrowRight");
    key("ArrowDown");
    expect(document.activeElement).toBe(actionsBtn(1));
    key("End");
    expect(document.activeElement).toBe(primary(2));
    key("ArrowRight");
    key("ArrowUp");
    expect(document.activeElement).toBe(actionsBtn(1));
  });

  it("Enter / Space on the primary cell switch; Enter on the menu button opens the menu only", () => {
    render(<Grid />);
    primary(2).focus();
    key("Enter");
    key(" ");
    expect(switchTo).toHaveBeenCalledTimes(2);
    expect(switchTo).toHaveBeenLastCalledWith("c");
    key("ArrowRight");
    fireEvent.click(document.activeElement as HTMLElement);
    expect(screen.getByRole("menu", { name: "Actions for Gamma" })).toBeTruthy();
    // Arrow keys inside the open menu stay with the menu.
    key("ArrowLeft");
    expect(document.activeElement?.getAttribute("role")).toBe("menuitem");
    expect(switchTo).toHaveBeenCalledTimes(2);
  });

  it("Delete deletes and Shift+F10 opens the menu from the primary cell", () => {
    render(<Grid />);
    primary(1).focus();
    key("Delete");
    expect(deleteWorkspace).toHaveBeenCalledWith("b", "Beta");
    key("F10", { shiftKey: true });
    expect(screen.getByRole("menu", { name: "Actions for Beta" })).toBeTruthy();
  });

  it("cards move in two dimensions; ArrowRight goes to the next card, not the menu (C3.3)", () => {
    const metas = [...METAS, meta("d", "Delta")];
    render(<Grid card cols={2} metas={metas} />);
    primary(0).focus();
    key("ArrowRight");
    expect(document.activeElement).toBe(primary(1));
    key("ArrowDown");
    expect(document.activeElement).toBe(primary(3));
    key("ArrowLeft");
    expect(document.activeElement).toBe(primary(2));
    key("ArrowUp");
    expect(document.activeElement).toBe(primary(0));
    // The menu still opens from the keyboard, and Escape returns to the card.
    key("F10", { shiftKey: true });
    expect(screen.getByRole("menu", { name: "Actions for Alpha" })).toBeTruthy();
    key("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(primary(0));
    expect(primary(0).getAttribute("aria-keyshortcuts")).toBe("1 F2 Delete Shift+F10 ContextMenu");
    expect(switchTo).not.toHaveBeenCalled();
  });

  it("focus on an action (a click) makes its row the tab stop; removing it repairs focus (C2.1)", async () => {
    const { rerender } = render(<Grid />);
    actionsBtn(2).focus();
    await waitFor(() => expect(primary(2).tabIndex).toBe(0));
    expect(primary(0).tabIndex).toBe(-1);
    rerender(<Grid metas={METAS.slice(0, 2)} />);
    await waitFor(() => expect(document.activeElement).toBe(primary(1)));
  });

  it("Enter in the rename box saves and returns focus to the primary cell (C2.2)", async () => {
    const sent: RpcRequest[] = [];
    setTransport(async (msg: RpcRequest) => {
      sent.push(msg);
      return { ok: true, value: {} };
    });
    render(<Grid />);
    primary(1).focus();
    key("F2");
    const input = await screen.findByRole("textbox", { name: "Rename" });
    input.focus(); // autoFocus (happy-dom does not apply it)
    fireEvent.input(input, { target: { value: "Bravo" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(sent[0]).toMatchObject({ type: "workspace.update", payload: { id: "b" } });
    expect(document.activeElement).toBe(primary(1));
  });

  it("Escape cancels the rename and returns focus to the primary cell (C2.2)", async () => {
    render(<Grid />);
    primary(2).focus();
    key("F2");
    const input = await screen.findByRole("textbox", { name: "Rename" });
    input.focus(); // autoFocus (happy-dom does not apply it)
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
    expect(document.activeElement).toBe(primary(2));
  });
});
