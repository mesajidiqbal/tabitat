// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { focusFirst, gridColumns, type RovingOptions, useRoving } from "./useRoving";

function List({ items, opts }: { items: string[]; opts?: RovingOptions }) {
  const roving = useRoving(items.length, opts);
  return (
    <div role="listbox" aria-label="list">
      {items.map((label, i) => {
        const it = roving.item(i);
        return (
          <div
            key={label}
            role="option"
            aria-selected={false}
            tabIndex={it.tabIndex}
            ref={it.ref}
            onFocus={it.onFocus}
            onKeyDown={it.onKeyDown}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

const tabStops = () => screen.getAllByRole("option").filter((x) => x.tabIndex === 0);

afterEach(cleanup);

describe("useRoving (DOM)", () => {
  it("keeps exactly one tab stop and moves it with the arrows", () => {
    render(<List items={["a", "b", "c"]} />);
    expect(tabStops().map((x) => x.textContent)).toEqual(["a"]);
    const [a] = screen.getAllByRole("option");
    a?.focus();
    fireEvent.keyDown(a as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("b");
    expect(tabStops().map((x) => x.textContent)).toEqual(["b"]);
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "End" });
    expect(document.activeElement?.textContent).toBe("c");
    expect(tabStops()).toHaveLength(1);
  });

  it("focus moves to the clamped index when the focused item is removed", async () => {
    const { rerender } = render(<List items={["a", "b", "c"]} />);
    const c = screen.getByText("c");
    c.focus();
    expect(document.activeElement).toBe(c);
    rerender(<List items={["a", "b"]} />);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("b"));
    expect(tabStops().map((x) => x.textContent)).toEqual(["b"]);
  });

  it("removing a middle item focuses the item now at its place", async () => {
    const { rerender } = render(<List items={["a", "b", "c"]} />);
    screen.getByText("b").focus();
    rerender(<List items={["a", "c"]} />);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("c"));
  });

  it("an item replaced in place (new key, same count) gets focus back at its index", async () => {
    const { rerender } = render(<List items={["a", "b", "c"]} />);
    screen.getByText("b").focus();
    rerender(<List items={["a", "b2", "c"]} />);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("b2"));
    expect(tabStops().map((x) => x.textContent)).toEqual(["b2"]);
  });

  it("removing the last item hands focus to onEmpty (e.g. the section heading, C2.3)", async () => {
    const opts = { onEmpty: vi.fn(() => focusFirst("missing", "list-h")) };
    const Page = ({ items }: { items: string[] }) => (
      <>
        <h2 id="list-h" tabIndex={-1}>
          Things
        </h2>
        <List items={items} opts={opts} />
      </>
    );
    const { rerender } = render(<Page items={["a"]} />);
    screen.getByText("a").focus();
    rerender(<Page items={[]} />);
    await waitFor(() => expect(document.activeElement?.id).toBe("list-h"));
    expect(opts.onEmpty).toHaveBeenCalledTimes(1);
    // Later renders do not call it again.
    rerender(<Page items={[]} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(opts.onEmpty).toHaveBeenCalledTimes(1);
  });

  it("onEmpty is not called when focus is somewhere else", async () => {
    const onEmpty = vi.fn();
    const { rerender } = render(
      <>
        <button type="button">elsewhere</button>
        <List items={["a"]} opts={{ onEmpty }} />
      </>,
    );
    screen.getByText("a").focus();
    screen.getByRole("button", { name: "elsewhere" }).focus();
    rerender(
      <>
        <button type="button">elsewhere</button>
        <List items={[]} opts={{ onEmpty }} />
      </>,
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(onEmpty).not.toHaveBeenCalled();
    expect(document.activeElement?.textContent).toBe("elsewhere");
  });

  it("with columns, the arrows move in two dimensions", () => {
    render(<List items={["a", "b", "c", "d", "e"]} opts={{ columns: () => 2 }} />);
    screen.getByText("a").focus();
    const key = (k: string) => fireEvent.keyDown(document.activeElement as HTMLElement, { key: k });
    key("ArrowRight");
    expect(document.activeElement?.textContent).toBe("b");
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("d");
    key("ArrowDown");
    expect(document.activeElement?.textContent).toBe("e");
    key("ArrowUp");
    expect(document.activeElement?.textContent).toBe("c");
    key("ArrowLeft");
    expect(document.activeElement?.textContent).toBe("b");
  });

  it("gridColumns counts the rows on the first row's line", () => {
    const grid = document.createElement("div");
    const tops = [0, 0, 0, 60, 60];
    for (const top of tops) {
      const row = document.createElement("div");
      row.setAttribute("role", "row");
      Object.defineProperty(row, "offsetTop", { value: top });
      grid.append(row);
    }
    expect(gridColumns(grid)).toBe(3);
    expect(gridColumns(document.createElement("div"))).toBe(1);
    expect(gridColumns(null)).toBe(1);
  });
});
