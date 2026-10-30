import { describe, expect, it } from "vitest";
import { NOW } from "../testing/fixtures";
import { DAY_MS, isBackupDue, reminderDecision, snoozeReminder } from "./reminder";

const installed = NOW - 40 * DAY_MS;
const meta = { installedAt: installed };
const on = { backupReminderDays: 30 };

describe("reminderDecision", () => {
  it("due (since install): writes { dueSince: now }", () => {
    expect(reminderDecision(meta, on, null, NOW)).toEqual({
      action: "write",
      record: { dueSince: NOW },
    });
  });

  it("due with an open record: keeps it (dueSince preserved)", () => {
    expect(reminderDecision(meta, on, { dueSince: NOW - DAY_MS }, NOW)).toEqual({ action: "keep" });
  });

  it("not due: nothing to write; an old record is removed", () => {
    const recent = { installedAt: NOW - 10 * DAY_MS };
    expect(reminderDecision(recent, on, null, NOW)).toEqual({ action: "keep" });
    expect(reminderDecision(recent, on, { dueSince: 1 }, NOW)).toEqual({ action: "remove" });
    // exactly on the boundary is not yet due
    expect(isBackupDue({ installedAt: NOW - 30 * DAY_MS }, 30, NOW)).toBe(false);
    expect(isBackupDue({ installedAt: NOW - 30 * DAY_MS - 1 }, 30, NOW)).toBe(true);
  });

  it("snoozed: left alone while the snooze runs", () => {
    const rec = { dueSince: NOW - 3 * DAY_MS, snoozedUntil: NOW + DAY_MS };
    expect(reminderDecision(meta, on, rec, NOW)).toEqual({ action: "keep" });
  });

  it("snooze expired: rewritten without snoozedUntil, dueSince kept", () => {
    const rec = { dueSince: NOW - 9 * DAY_MS, snoozedUntil: NOW };
    expect(reminderDecision(meta, on, rec, NOW)).toEqual({
      action: "write",
      record: { dueSince: NOW - 9 * DAY_MS },
    });
  });

  it("off (0 days): removes a record, never writes", () => {
    const off = { backupReminderDays: 0 };
    expect(reminderDecision(meta, off, { dueSince: 1 }, NOW)).toEqual({ action: "remove" });
    expect(reminderDecision(meta, off, null, NOW)).toEqual({ action: "keep" });
    expect(isBackupDue(meta, 0, NOW)).toBe(false);
  });

  it("after an export: lastBackupAt wins over installedAt", () => {
    const backedUp = { installedAt: installed, lastBackupAt: NOW - DAY_MS };
    expect(reminderDecision(backedUp, on, null, NOW)).toEqual({ action: "keep" });
    expect(reminderDecision(backedUp, on, { dueSince: 1 }, NOW)).toEqual({ action: "remove" });
    const stale = { installedAt: installed, lastBackupAt: NOW - 31 * DAY_MS };
    expect(reminderDecision(stale, on, null, NOW).action).toBe("write");
  });

  it("no readable meta: keep (undecidable)", () => {
    expect(reminderDecision(null, on, { dueSince: 1 }, NOW)).toEqual({ action: "keep" });
  });
});

describe("snoozeReminder", () => {
  it("keeps dueSince, sets snoozedUntil = now + days", () => {
    expect(snoozeReminder({ dueSince: 5 }, 7, NOW)).toEqual({
      dueSince: 5,
      snoozedUntil: NOW + 7 * DAY_MS,
    });
    expect(snoozeReminder(null, 1, NOW)).toEqual({ dueSince: NOW, snoozedUntil: NOW + DAY_MS });
  });
});
