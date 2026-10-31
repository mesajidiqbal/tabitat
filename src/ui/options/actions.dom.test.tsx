// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmAction } from "./actions";

afterEach(cleanup);

const renderConfirm = (onConfirm = vi.fn()) => {
  render(<ConfirmAction label="Empty trash" prompt="Delete everything?" onConfirm={onConfirm} />);
  return onConfirm;
};

describe("ConfirmAction (DOM)", () => {
  it("is an inline group labelled by its prompt, not a modal dialog (C3.4)", async () => {
    renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    const group = await screen.findByRole("group", { name: "Delete everything?" });
    expect(group.getAttribute("aria-modal")).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("moves focus to Cancel; Confirm runs the action and returns focus to the trigger", async () => {
    const onConfirm = renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    screen.getByRole("button", { name: "Confirm" }).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Empty trash"));
  });

  it("Escape cancels and refocuses the trigger", async () => {
    const onConfirm = renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("group")).toBeNull());
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Empty trash"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not trap Tab (the browser moves focus on)", async () => {
    renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Cancel"));
    const ev = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    (document.activeElement as HTMLElement).dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.getByRole("group")).toBeTruthy();
  });

  it("Cancel refocuses the trigger", async () => {
    renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    await waitFor(() => screen.getByRole("group"));
    screen.getByRole("button", { name: "Cancel" }).click();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Empty trash"));
  });
});
