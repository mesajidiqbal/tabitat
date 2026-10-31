// @vitest-environment happy-dom
// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceMeta } from "@/core/model/types";

const switchTo = vi.hoisted(() => vi.fn(async () => true));
const deleteWorkspace = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../actions", async (orig) => ({
  ...(await orig<typeof import("../actions")>()),
  switchTo,
  deleteWorkspace,
}));

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

function Grid({ card = false }: { card?: boolean }) {
  const roving = useRoving(METAS.length);
  return (
    <div role="grid" aria-label="Workspaces" aria-rowcount={METAS.length}>
      {METAS.map((m, i) => (
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
});

describe("WorkspaceRow grid", () => {
  it("renders rows with a primary cell and an Actions cell; the active one is selected", () => {
    render(<Grid />);
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(rows().map((r) => r.getAttribute("aria-rowindex"))).toEqual(["1", "2", "3"]);
    const cells = rows()[1]?.querySelectorAll(':scope > [role="gridcell"]') ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[1]?.getAttribute("aria-label")).toBe("Actions");
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
    render(<Grid card />);
    primary(0).focus();
    key("ArrowDown");
    expect(document.activeElement).toBe(primary(1));
    key("End");
    expect(document.activeElement).toBe(primary(2));
    key("Home");
    expect(document.activeElement).toBe(primary(0));
    key("ArrowRight");
    key("ArrowDown");
    expect(document.activeElement).toBe(primary(1));
    key("ArrowRight");
    key("End");
    expect(document.activeElement).toBe(primary(2));
    key("ArrowRight");
    key("ArrowUp");
    expect(document.activeElement).toBe(primary(1));
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
});
