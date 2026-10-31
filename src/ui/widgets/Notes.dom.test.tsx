// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTransport } from "@/messaging/client";
import type { RpcRequest } from "@/messaging/commands";
import { Notes } from "./Notes";
import { resetNoteDrafts } from "./noteDrafts";
import { records } from "./records";

type NotePayload = { scope: string; content: string; expectedRev?: number };
let calls: NotePayload[] = [];
/** What the fake worker answers to note.set: conflict until `accept` is set. */
let accept = false;
const stored = { content: "theirs", updatedAt: 5, rev: 4 };

beforeEach(() => {
  calls = [];
  accept = false;
  records.notes.value = { global: { content: "old", updatedAt: 1, rev: 3 } };
  setTransport(async (msg: RpcRequest) => {
    const p = msg.payload as NotePayload;
    calls.push(p);
    if (!accept) return { ok: false, code: "conflict", message: "note changed", retryable: true };
    return { ok: true, value: { content: p.content, updatedAt: 9, rev: (p.expectedRev ?? 0) + 1 } };
  });
  vi.stubGlobal("chrome", {
    storage: { local: { get: async () => ({ "notes:global": stored }) } },
  });
});

afterEach(() => {
  cleanup();
  setTransport(null);
  vi.unstubAllGlobals();
  records.notes.value = {};
  resetNoteDrafts();
});

const textarea = () => screen.getByRole("textbox", { name: "Notes" }) as HTMLTextAreaElement;
const type = (text: string) => fireEvent.input(textarea(), { target: { value: text } });

describe("Notes (DOM)", () => {
  it("autosaves after a pause with expectedRev; a conflict keeps the draft and asks", async () => {
    render(<Notes />);
    expect(textarea().value).toBe("old");
    type("my draft");
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ scope: "global", content: "my draft", expectedRev: 3 });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Changed elsewhere");
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep mine" })).toBeTruthy();
    expect(textarea().value).toBe("my draft");
    // While the notice is up, typing never saves blindly over the other change.
    type("my draft, longer");
    await new Promise((r) => setTimeout(r, 650));
    expect(calls).toHaveLength(1);
    expect(textarea().value).toBe("my draft, longer");
  });

  it("Keep mine overwrites with the draft against the current stored rev", async () => {
    render(<Notes />);
    type("mine");
    await screen.findByRole("alert");
    accept = true;
    fireEvent.click(screen.getByRole("button", { name: "Keep mine" }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ scope: "global", content: "mine", expectedRev: 4 });
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(textarea().value).toBe("mine");
  });

  it("Reload drops the draft and shows the stored note", async () => {
    render(<Notes />);
    type("mine");
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(textarea().value).toBe("theirs"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Preview renders markdown as elements (no HTML passthrough)", () => {
    records.notes.value = {
      global: { content: "# Hi\n<b>x</b> [l](https://a.test)", updatedAt: 1, rev: 1 },
    };
    render(<Notes />);
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("heading", { name: "Hi" })).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByText(/<b>x<\/b>/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "l" });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("a conflicted draft survives unmount: remounting shows it with the notice (C-B1)", async () => {
    const first = render(<Notes />);
    type("my draft");
    await screen.findByRole("alert");
    first.unmount();
    // The unmount does not try to save the conflicted draft over the other change.
    await new Promise((r) => setTimeout(r, 650));
    expect(calls).toHaveLength(1);
    render(<Notes />);
    expect(textarea().value).toBe("my draft");
    expect(screen.getByRole("alert").textContent).toContain("Changed elsewhere");
    expect(sessionStorage.getItem("tabitat:noteDraft:global")).toContain("my draft");
  });

  it("a conflicted draft is restored from sessionStorage after a reload", async () => {
    const first = render(<Notes />);
    type("before reload");
    await screen.findByRole("alert");
    first.unmount();
    resetNoteDrafts(true);
    render(<Notes />);
    expect(textarea().value).toBe("before reload");
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("a clean pending draft is saved on unmount and cleared once acknowledged", async () => {
    accept = true;
    const first = render(<Notes />);
    type("quick note");
    first.unmount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ scope: "global", content: "quick note", expectedRev: 3 });
    await waitFor(() => expect(sessionStorage.getItem("tabitat:noteDraft:global")).toBeNull());
  });
});
