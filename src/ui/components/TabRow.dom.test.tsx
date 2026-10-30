// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { RovingItem } from "../hooks/useRoving";
import type { RowAction } from "./RowActions";
import { TabRow } from "./TabRow";

const item = (): RovingItem => ({
  tabIndex: 0,
  ref: () => {},
  onFocus: () => {},
  onKeyDown: vi.fn(),
});

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
    fireEvent.keyDown(screen.getByRole("option"), { key: "Enter" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("p parks, z suspends, Delete runs the del action", () => {
    renderRow();
    const row = screen.getByRole("option");
    fireEvent.keyDown(row, { key: "p" });
    fireEvent.keyDown(row, { key: "z" });
    fireEvent.keyDown(row, { key: "Delete" });
    expect(park).toHaveBeenCalledTimes(1);
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
    expect(row.getAttribute("aria-keyshortcuts")).toBe("Delete p z Shift+F10 ContextMenu");
  });

  it("menu-only actions get no hover button", () => {
    renderRow();
    expect(screen.queryByRole("button", { name: "Never suspend this site" })).toBeNull();
    expect(screen.getByRole("button", { name: "Suspend" })).toBeTruthy();
  });

  it("ContextMenu opens a menu listing every action (menu-only included)", () => {
    renderRow();
    fireEvent.keyDown(screen.getByRole("option"), { key: "ContextMenu" });
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
    const row = screen.getByRole("option");
    for (const key of ["Enter", "p", "z", "Delete", "ContextMenu"]) fireEvent.keyDown(row, { key });
    fireEvent.click(row);
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
    expect(screen.getByRole("option").getAttribute("draggable")).toBeNull();
    rerender(
      <TabRow
        title="Example"
        url="https://example.com/"
        item={item()}
        onOpen={open}
        onDragStart={onDragStart}
      />,
    );
    const row = screen.getByRole("option");
    expect(row.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(row);
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });
});
