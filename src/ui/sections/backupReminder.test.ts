import { describe, expect, it } from "vitest";
import {
  daysSinceBackup,
  parseBannerSettings,
  parseReminder,
  reminderVisible,
} from "./backupReminder";

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

describe("reminderVisible", () => {
  it("is hidden without a record", () => {
    expect(reminderVisible(null, NOW)).toBe(false);
    expect(reminderVisible(undefined, NOW)).toBe(false);
  });

  it("shows a due record that was never snoozed", () => {
    expect(reminderVisible({ dueSince: NOW - DAY }, NOW)).toBe(true);
  });

  it("hides while snoozed and shows again once the snooze has ended", () => {
    expect(reminderVisible({ dueSince: NOW - DAY, snoozedUntil: NOW + 1 }, NOW)).toBe(false);
    expect(reminderVisible({ dueSince: NOW - DAY, snoozedUntil: NOW }, NOW)).toBe(true);
    expect(reminderVisible({ dueSince: NOW - DAY, snoozedUntil: NOW - 1 }, NOW)).toBe(true);
  });

  it("is hidden when the reminder is off, whatever the record says (C-B6)", () => {
    expect(reminderVisible({ dueSince: NOW - DAY }, NOW, 0)).toBe(false);
    expect(reminderVisible({ dueSince: NOW - DAY, snoozedUntil: NOW - 1 }, NOW, 0)).toBe(false);
    expect(reminderVisible({ dueSince: NOW - DAY }, NOW, 30)).toBe(true);
    // Settings not known yet: the record decides.
    expect(reminderVisible({ dueSince: NOW - DAY }, NOW, undefined)).toBe(true);
  });
});

describe("parseReminder", () => {
  it("keeps a valid record and drops an unusable snooze", () => {
    expect(parseReminder({ dueSince: 5, snoozedUntil: 9 })).toEqual({
      dueSince: 5,
      snoozedUntil: 9,
    });
    expect(parseReminder({ dueSince: 5, snoozedUntil: "soon" })).toEqual({ dueSince: 5 });
    expect(parseReminder({ dueSince: 5, snoozedUntil: Number.NaN })).toEqual({ dueSince: 5 });
  });

  it("rejects anything that is not a record with a numeric dueSince", () => {
    for (const bad of [undefined, null, 3, "x", [], {}, { dueSince: "1" }, { dueSince: Infinity }])
      expect(parseReminder(bad)).toBeNull();
  });
});

describe("daysSinceBackup", () => {
  it("counts whole days and never goes negative", () => {
    expect(daysSinceBackup(NOW - 3 * DAY - 5, NOW)).toBe(3);
    expect(daysSinceBackup(NOW - 1000, NOW)).toBe(0);
    expect(daysSinceBackup(NOW + DAY, NOW)).toBe(0);
  });

  it("is null when there was no backup", () => {
    expect(daysSinceBackup(undefined, NOW)).toBeNull();
    expect(daysSinceBackup("x", NOW)).toBeNull();
  });
});

describe("parseBannerSettings", () => {
  it("reads rev and the cadence (default 30)", () => {
    expect(parseBannerSettings({ rev: 4, backupReminderDays: 0 })).toEqual({
      rev: 4,
      backupReminderDays: 0,
    });
    expect(parseBannerSettings({ rev: 2 })).toEqual({ rev: 2, backupReminderDays: 30 });
    expect(parseBannerSettings({ rev: 2, backupReminderDays: -1 })?.backupReminderDays).toBe(30);
  });

  it("is undefined without a usable rev (no guessed expectedRev)", () => {
    for (const bad of [undefined, null, [], {}, { rev: "1" }, { rev: -1 }, { rev: 1.5 }])
      expect(parseBannerSettings(bad)).toBeUndefined();
  });
});
