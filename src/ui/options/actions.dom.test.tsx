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
  it("moves focus to the confirm button and returns it to the trigger after confirming", async () => {
    const onConfirm = renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Confirm"));
    const dialog = screen.getByRole("alertdialog", { name: "Empty trash" });
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    (document.activeElement as HTMLElement).click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Empty trash"));
  });

  it("Escape cancels and refocuses the trigger", async () => {
    const onConfirm = renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Confirm"));
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Empty trash"));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Cancel refocuses the trigger", async () => {
    renderConfirm();
    screen.getByRole("button", { name: "Empty trash" }).click();
    await waitFor(() => screen.getByRole("alertdialog"));
    screen.getByRole("button", { name: "Cancel" }).click();
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Empty trash"));
  });
});
