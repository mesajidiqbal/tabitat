// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/core/model/types";
import { type SettingsApi, SettingsApiContext, type SettingsPatch } from "./SettingsContext";
import { WhitelistEditor } from "./WhitelistEditor";

type Update = (section: string, patch: SettingsPatch, baseRev?: number) => Promise<boolean>;
let update: ReturnType<typeof vi.fn<Update>>;

const api = (whitelist: string[] = ["a.example"]): SettingsApi => ({
  settings: { ...DEFAULT_SETTINGS, rev: 3, suspend: { ...DEFAULT_SETTINGS.suspend, whitelist } },
  update,
  saved: null,
  notice: null,
  error: null,
  epoch: 0,
  dismiss: () => {},
});

const renderEditor = () =>
  render(
    <SettingsApiContext.Provider value={api()}>
      <WhitelistEditor />
    </SettingsApiContext.Provider>,
  );

const area = () => screen.getByLabelText("Never suspend these sites") as HTMLTextAreaElement;
const type = (v: string) => fireEvent.input(area(), { target: { value: v } });

beforeEach(() => {
  vi.useFakeTimers();
  update = vi.fn<Update>(async () => true);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("WhitelistEditor", () => {
  it("saves the normalized list 300 ms after typing, with the draft's base rev", () => {
    renderEditor();
    type("a.example\nB.example");
    expect(update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(update).toHaveBeenCalledWith(
      "suspension",
      { suspend: { whitelist: ["a.example", "b.example"] } },
      3,
    );
  });

  it("an invalid line blocks autosave and marks the textarea invalid", () => {
    renderEditor();
    type("b.example\nnot a host");
    vi.advanceTimersByTime(1000);
    fireEvent.blur(area());
    expect(update).not.toHaveBeenCalled();
    expect(area().getAttribute("aria-invalid")).toBe("true");
    const described = area().getAttribute("aria-describedby")?.split(" ") ?? [];
    const errors = described.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    expect(errors).toContain("Line 2");
    expect(errors).toContain("Nothing is saved until every line is a valid host.");
  });

  it("blur flushes the pending draft at once", () => {
    renderEditor();
    type("c.example");
    fireEvent.blur(area());
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).toEqual({ suspend: { whitelist: ["c.example"] } });
    vi.advanceTimersByTime(1000);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("unmount (section navigation) flushes the pending draft", () => {
    const { unmount } = renderEditor();
    type("d.example");
    unmount();
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]?.[1]).toEqual({ suspend: { whitelist: ["d.example"] } });
  });

  it("typing back the stored list saves nothing", () => {
    const { unmount } = renderEditor();
    type("a.example ");
    unmount();
    expect(update).not.toHaveBeenCalled();
  });
});
