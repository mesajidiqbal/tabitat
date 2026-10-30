// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/messaging/client", () => ({ send }));
const downloads = vi.hoisted(() => vi.fn());
vi.mock("../download", async (orig) => ({
  ...(await orig<typeof import("../download")>()),
  downloadJson: (name: string, data: unknown) =>
    downloads(name, JSON.stringify(data), "application/json"),
  downloadText: downloads,
}));

import { BackupBanner } from "./BackupBanner";

const DAY = 24 * 60 * 60 * 1000;

/** Minimal chrome.storage.local: `get` serves `data`; `onChanged` is inert. */
function stubStorage(data: Record<string, unknown>) {
  vi.stubGlobal("chrome", {
    storage: {
      local: { get: async (key: string) => (key in data ? { [key]: data[key] } : {}) },
      onChanged: { addListener: () => {}, removeListener: () => {} },
    },
  });
}

beforeEach(() => {
  send.mockReset();
  downloads.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("BackupBanner", () => {
  it("shows the days since the last backup with its three actions when a reminder is due", async () => {
    stubStorage({
      "backup:reminder": { dueSince: Date.now() - DAY },
      meta: { lastBackupAt: Date.now() - 12 * DAY - 1000 },
    });
    render(<BackupBanner />);
    expect(await screen.findByText("Last backup 12 days ago")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
    for (const name of ["Export", "Remind me in a week", "Turn off"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
  });

  it("says so when there has been no backup", async () => {
    stubStorage({ "backup:reminder": { dueSince: Date.now() - DAY } });
    render(<BackupBanner />);
    expect(await screen.findByText("No backup yet")).toBeTruthy();
  });

  it("renders nothing without a record, or while the reminder is snoozed", async () => {
    stubStorage({ meta: {} });
    const { container, unmount } = render(<BackupBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
    unmount();

    stubStorage({
      "backup:reminder": { dueSince: Date.now() - DAY, snoozedUntil: Date.now() + DAY },
    });
    const second = render(<BackupBanner />);
    await new Promise((r) => setTimeout(r, 20));
    expect(second.container.textContent).toBe("");
  });

  it("Export downloads the JSON backup", async () => {
    stubStorage({ "backup:reminder": { dueSince: 1 } });
    const file = {
      format: "tabitat-backup",
      version: 1,
      exportedAt: Date.UTC(2026, 9, 31),
      data: {},
    };
    send.mockResolvedValue(file);
    render(<BackupBanner />);
    (await screen.findByRole("button", { name: "Export" })).click();
    await waitFor(() => expect(downloads).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith("backup.export", {});
    expect(downloads.mock.calls[0]?.[0]).toBe("tabitat-backup-2026-10-31.json");
    expect(downloads.mock.calls[0]?.[2]).toBe("application/json");
  });

  it("Remind me in a week snoozes for 7 days", async () => {
    stubStorage({ "backup:reminder": { dueSince: 1 } });
    send.mockResolvedValue(null);
    render(<BackupBanner />);
    (await screen.findByRole("button", { name: "Remind me in a week" })).click();
    await waitFor(() => expect(send).toHaveBeenCalledWith("reminder.snooze", { days: 7 }));
  });

  it("Turn off writes backupReminderDays 0 against the current settings rev", async () => {
    stubStorage({ "backup:reminder": { dueSince: 1 }, settings: { rev: 9 } });
    send.mockResolvedValue({ rev: 10 });
    render(<BackupBanner />);
    const turnOff = await screen.findByRole("button", { name: "Turn off" });
    await new Promise((r) => setTimeout(r, 20)); // the settings read resolves on its own
    turnOff.click();
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith("settings.update", {
        patch: { backupReminderDays: 0 },
        expectedRev: 9,
      }),
    );
  });

  it("Turn off uses the onTurnOff override when given", async () => {
    stubStorage({ "backup:reminder": { dueSince: 1 } });
    const off = vi.fn().mockResolvedValue(true);
    render(<BackupBanner variant="page" onTurnOff={off} />);
    (await screen.findByRole("button", { name: "Turn off" })).click();
    await waitFor(() => expect(off).toHaveBeenCalledTimes(1));
    expect(send).not.toHaveBeenCalled();
  });

  it("shows a failed action as an alert", async () => {
    stubStorage({ "backup:reminder": { dueSince: 1 } });
    send.mockRejectedValue(new Error("boom"));
    render(<BackupBanner />);
    (await screen.findByRole("button", { name: "Remind me in a week" })).click();
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
