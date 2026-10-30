// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it } from "vitest";
import { useRoving } from "./useRoving";

function List({ items }: { items: string[] }) {
  const roving = useRoving(items.length);
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
});
