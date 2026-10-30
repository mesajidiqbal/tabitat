// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dismissToast, showToast, Toast, useUndoToast } from "./Toast";

afterEach(() => {
  act(() => dismissToast());
  cleanup();
  vi.useRealTimers();
});

describe("Toast (DOM)", () => {
  it("the Undo action runs once and dismisses the toast", () => {
    const undo = vi.fn();
    render(<Toast />);
    act(() => showToast({ message: "Closed “Example”", action: { label: "Undo", run: undo } }));
    expect(screen.getByText("Closed “Example”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Closed “Example”")).toBeNull();
  });

  it("useUndoToast shows an 8 s toast that expires", () => {
    vi.useFakeTimers();
    const undo = vi.fn();
    let make: ReturnType<typeof useUndoToast> | undefined;
    function Probe() {
      make = useUndoToast();
      return null;
    }
    render(
      <>
        <Probe />
        <Toast />
      </>,
    );
    act(() => make?.("Deleted “Work”", undo));
    expect(screen.getByRole("button", { name: "Undo" })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(7_900);
    });
    expect(screen.queryByText("Deleted “Work”")).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("Deleted “Work”")).toBeNull();
    expect(undo).not.toHaveBeenCalled();
  });
});
