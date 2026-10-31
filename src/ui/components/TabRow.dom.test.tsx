// @vitest-environment happy-dom
// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type RovingItem, useRoving } from "../hooks/useRoving";
import type { RowAction } from "./RowActions";
import { TabRow } from "./TabRow";

const item = (): RovingItem => ({
  tabIndex: 0,
  ref: () => {},
  onFocus: () => {},
  onKeyDown: vi.fn(),
  nav: vi.fn(() => false),
});

/** The primary cell (roving node, keys) and the row (click, context menu, drag). */
const cell = () => screen.getAllByRole("gridcell")[0] as HTMLElement;
const row = () => screen.getByRole("row");

type Fn = Mock<() => void>;
let open: Fn;
let park: Fn;
let suspend: Fn;
let close: Fn;
let never: Fn;

const actions = (): RowAction[] => [
  { label: "Close tab", icon: null, run: close, del: true },
  { label: "Park to saved links", icon: null, run: park, key: "p" },
  { label: "Suspend", icon: null, run: suspend, key: "z" },
  { label: "Never suspend this site", icon: null, run: never, menuOnly: true },
];

const renderRow = (disabled = false) =>
  render(
    <TabRow
      title="Example"
      url="https://example.com/"
      item={item()}
      onOpen={open}
      actions={actions()}
      disabled={disabled}
    />,
  );

beforeEach(() => {
  vi.stubGlobal("chrome", { runtime: { getURL: (p: string) => `chrome-extension://x${p}` } });
  open = vi.fn<() => void>();
  park = vi.fn<() => void>();
  suspend = vi.fn<() => void>();
  close = vi.fn<() => void>();
  never = vi.fn<() => void>();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TabRow keys", () => {
  it("Enter opens the row", () => {
    renderRow();
    fireEvent.keyDown(cell(), { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("p parks, z suspends, Delete runs the del action", () => {
    renderRow();
    const primary = cell();
    fireEvent.keyDown(primary, { key: "p" });
    fireEvent.keyDown(primary, { key: "z" });
    fireEvent.keyDown(primary, { key: "Delete" });
    expect(park).toHaveBeenCalledTimes(1);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(primary.getAttribute("aria-keyshortcuts")).toBe("Delete p z Shift+F10 ContextMenu");
  });

  it("action keys ignore Caps Lock case but not Shift or modifiers", () => {
    renderRow();
    const primary = cell();
    fireEvent.keyDown(primary, { key: "Z" });
    expect(suspend).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(primary, { key: "Z", shiftKey: true });
    fireEvent.keyDown(primary, { key: "z", ctrlKey: true });
    expect(suspend).toHaveBeenCalledTimes(1);
  });

  it("menu-only actions get no hover button", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: "Never suspend this site" })).toBeNull();
    expect(screen.getByRole("button", { name: "Suspend" })).toBeTruthy();
  });

  it("ContextMenu opens a menu listing every action (menu-only included)", () => {
    renderRow();
    fireEvent.keyDown(cell(), { key: "ContextMenu" });
    const items = screen.getAllByRole("menuitem").map((x) => x.textContent);
    expect(items).toEqual([
      "Close tabDel",
      "Park to saved linksP",
      "SuspendZ",
      "Never suspend this site",
    ]);
    fireEvent.click(screen.getByRole("menuitem", { name: /Never suspend/ }));
    expect(never).toHaveBeenCalledTimes(1);
  });

  it("a disabled row ignores keys and clicks", () => {
    renderRow(true);
    for (const key of ["Enter", "p", "z", "Delete", "ContextMenu"])
      fireEvent.keyDown(cell(), { key });
    fireEvent.click(row());
    expect(open).not.toHaveBeenCalled();
    expect(park).not.toHaveBeenCalled();
    expect(suspend).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows the chip and the suspended glyph with its tooltip", () => {
    render(
      <TabRow
        title="Example"
        url="https://example.com/"
        item={item()}
        onOpen={open}
        suspended
        suspendedHint="Suspended"
        chip="Duplicate"
      />,
    );
    expect(screen.getByText("Duplicate")).toBeTruthy();
    expect(screen.getByTestId("suspended").getAttribute("title")).toBe("Suspended");
  });

  it("is draggable only with onDragStart", () => {
    const onDragStart = vi.fn();
    const { rerender } = renderRow();
    expect(row().getAttribute("draggable")).toBeNull();
    rerender(
      <TabRow
        title="Example"
        url="https://example.com/"
        item={item()}
        onOpen={open}
        onDragStart={onDragStart}
      />,
    );
    expect(row().getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(row());
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it("the visible overflow button and a right-click open the same menu", () => {
    renderRow();
    const more = screen.getByRole("button", { name: "Actions for Example" });
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    fireEvent.click(more);
    expect(screen.getAllByRole("menuitem")).toHaveLength(4);
    expect(open).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(row(), ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("a disabled row keeps the browser context menu", () => {
    renderRow(true);
    const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(row(), ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

/** Three rows in a grid with a real roving tabindex. */
function Grid({ onOpen }: { onOpen: () => void }) {
  const roving = useRoving(3);
  return (
    <div role="grid" aria-label="Tabs" aria-rowcount={3}>
      {["One", "Two", "Three"].map((title, i) => (
        <TabRow
          key={title}
          title={title}
          url={`https://example.com/${i}`}
          item={roving.item(i)}
          rowIndex={i + 1}
          onOpen={onOpen}
          actions={actions()}
        />
      ))}
    </div>
  );
}

describe("TabRow grid keys", () => {
  const primary = (i: number) =>
    screen.getAllByRole("row")[i]?.querySelector<HTMLElement>('[role="gridcell"]') as HTMLElement;
  const firstAction = (i: number) =>
    screen
      .getAllByRole("row")
      [i]?.querySelector<HTMLElement>('[data-cell="actions"] button') as HTMLElement;
  const key = (k: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: k });
  const focusedName = () =>
    document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent;

  it("is a row with a primary cell and an Actions cell, with its grid position", () => {
    render(<Grid onOpen={open} />);
    const rows = screen.getAllByRole("row");
    expect(rows.map((r) => r.getAttribute("aria-rowindex"))).toEqual(["1", "2", "3"]);
    const cells = rows[0]?.querySelectorAll(':scope > [role="gridcell"]') ?? [];
    expect(cells).toHaveLength(2);
    expect(cells[1]?.getAttribute("aria-description")).toBe("Actions");
    expect(cells[1]?.hasAttribute("aria-label")).toBe(false);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // One tab stop: the first row's primary cell; buttons are reached with the arrows.
    const stops = [...document.querySelectorAll<HTMLElement>("[tabindex]")].filter(
      (x) => x.tabIndex === 0,
    );
    expect(stops).toEqual([primary(0)]);
  });

  it("ArrowRight / ArrowLeft move between the primary cell and the action buttons", () => {
    render(<Grid onOpen={open} />);
    primary(0).focus();
    key("ArrowRight");
    expect(focusedName()).toBe("Close tab");
    key("ArrowRight");
    expect(focusedName()).toBe("Park to saved links");
    key("ArrowRight");
    key("ArrowRight");
    expect(focusedName()).toBe("Actions for One");
    key("ArrowRight");
    expect(focusedName()).toBe("Actions for One");
    key("ArrowLeft");
    key("ArrowLeft");
    key("ArrowLeft");
    expect(focusedName()).toBe("Close tab");
    key("ArrowLeft");
    expect(document.activeElement).toBe(primary(0));
    key("ArrowLeft");
    expect(document.activeElement).toBe(primary(0));
    expect(open).not.toHaveBeenCalled();
  });

  it("ArrowUp / ArrowDown / Home / End move rows, from either cell", () => {
    render(<Grid onOpen={open} />);
    primary(0).focus();
    key("ArrowDown");
    expect(document.activeElement).toBe(primary(1));
    key("End");
    expect(document.activeElement).toBe(primary(2));
    key("ArrowDown");
    expect(document.activeElement).toBe(primary(2));
    key("Home");
    expect(document.activeElement).toBe(primary(0));
    key("ArrowUp");
    expect(document.activeElement).toBe(primary(0));
    // From an action button: rows move to the neighbour's primary cell.
    key("ArrowRight");
    expect(focusedName()).toBe("Close tab");
    key("ArrowDown");
    expect(focusedName()).toBe("Close tab");
    expect(document.activeElement).toBe(firstAction(1));
    expect(primary(1).tabIndex).toBe(0);
    key("End");
    expect(document.activeElement).toBe(primary(2));
    key("ArrowRight");
    key("ArrowUp");
    expect(document.activeElement).toBe(firstAction(1));
    key("ArrowRight");
    key("Home");
    expect(document.activeElement).toBe(primary(0));
  });

  it("Enter and Space on the primary cell open the row; on a button they run only it", () => {
    render(<Grid onOpen={open} />);
    primary(1).focus();
    key("Enter");
    key(" ");
    expect(open).toHaveBeenCalledTimes(2);
    key("ArrowRight");
    fireEvent.click(document.activeElement as HTMLElement);
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(2);
  });
});
