// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuickLink } from "@/core/model/types";
import { setTransport } from "@/messaging/client";
import type { RpcRequest } from "@/messaging/commands";
import { store } from "../store";
import { QuickLinksGrid } from "./QuickLinksGrid";
import { resetSyncedRecords } from "./useSyncedRecord";

type SetPayload = { items: QuickLink[]; expectedRev?: number };
let sets: SetPayload[] = [];
let failWith: string | null = null;

const link = (id: string, order: number): QuickLink => ({
  id,
  url: `https://${id}.test/`,
  title: id.toUpperCase(),
  order,
});

beforeEach(() => {
  sets = [];
  failWith = null;
  store.quicklinks.value = [link("qa", 0), link("qb", 1), link("qc", 2)];
  store.quicklinksRev.value = 3;
  setTransport(async (msg: RpcRequest) => {
    const p = msg.payload as SetPayload;
    sets.push(p);
    if (failWith) return { ok: false, code: failWith, message: "nope", retryable: false };
    return { ok: true, value: { rev: (p.expectedRev ?? 0) + 1 } };
  });
  vi.stubGlobal("chrome", { runtime: { getURL: (p: string) => `chrome-extension://x${p}` } });
});

afterEach(() => {
  cleanup();
  resetSyncedRecords();
  setTransport(null);
  vi.unstubAllGlobals();
  store.quicklinks.value = [];
  store.quicklinksRev.value = 0;
});

const tile = (name: string) => screen.getByRole("link", { name });

describe("QuickLinksGrid (DOM)", () => {
  it("tiles are one Tab stop; arrows, Home and End move focus (C-X1)", () => {
    render(<QuickLinksGrid />);
    expect(["QA", "QB", "QC"].map((n) => tile(n).getAttribute("tabindex"))).toEqual([
      "0",
      "-1",
      "-1",
    ]);
    expect(tile("QA").querySelector("img")?.getAttribute("loading")).toBe("lazy");
    tile("QA").focus();
    fireEvent.keyDown(tile("QA"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(tile("QB"));
    fireEvent.keyDown(tile("QB"), { key: "End" });
    expect(document.activeElement).toBe(tile("QC"));
    fireEvent.keyDown(tile("QC"), { key: "Home" });
    expect(document.activeElement).toBe(tile("QA"));
    // The tile menu opens from the keyboard; its trigger is not a Tab stop.
    const trigger = screen.getByRole("button", { name: "Quick link actions: QA" });
    expect(trigger.getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(tile("QA"), { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Quick link actions: QA" })).toBeTruthy();
  });

  it("Save closes the form once written and focus returns to the Add button (C-X4)", async () => {
    render(<QuickLinksGrid />);
    fireEvent.click(screen.getByRole("button", { name: "Add quick link" }));
    fireEvent.input(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "example.org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "URL" })).toBeNull());
    expect(sets).toHaveLength(1);
    expect(sets[0]?.items.at(-1)?.url).toBe("https://example.org/");
    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Add quick link"),
    );
  });

  it("a failed save keeps the form and its values; Discard drops the edit (C-B2)", async () => {
    failWith = "internal";
    render(<QuickLinksGrid />);
    fireEvent.click(screen.getByRole("button", { name: "Add quick link" }));
    fireEvent.input(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "example.org" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Not saved");
    expect((screen.getByRole("textbox", { name: "URL" }) as HTMLInputElement).value).toBe(
      "example.org",
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.queryByRole("link", { name: "example.org" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "URL" })).toBeTruthy();
  });
});
