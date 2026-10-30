// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberField } from "./fields";
import { RANGES } from "./settings";

afterEach(cleanup);

const field = (onCommit = vi.fn()) => {
  render(
    <NumberField label="Every" value={30} {...RANGES.backupReminderDays} onCommit={onCommit} />,
  );
  return { onCommit, input: screen.getByLabelText("Every") as HTMLInputElement };
};

describe("NumberField with an off value (backup reminder days)", () => {
  it("accepts 0 as off and saves it on blur", () => {
    const { onCommit, input } = field();
    fireEvent.input(input, { target: { value: "0" } });
    expect(input.getAttribute("aria-invalid")).toBeNull();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(0);
  });

  it("flags 1-6 with the off-aware range hint and clamps to 7 on blur", () => {
    const { onCommit, input } = field();
    fireEvent.input(input, { target: { value: "3" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Enter 0 (off) or a whole number from 7 to 365.")).toBeTruthy();
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(7);
  });

  it("accepts the ends of the range", () => {
    const { onCommit, input } = field();
    fireEvent.input(input, { target: { value: "365" } });
    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(365);
  });
});
