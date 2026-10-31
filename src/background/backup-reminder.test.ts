import { describe, expect, it } from "vitest";
import { DAY_MS } from "../core/backup/reminder";
import type { Meta, WindowState } from "../core/model/types";
import { Keys } from "../core/model/types";
import type { FakeBrowser } from "../platform/fake";
import { BgKeys } from "./keys";
import { seedWorkspace, settle, setup, stored } from "./testing/harness";

/** An install from `daysAgo` days ago (meta at the current schema: no migration runs). */
const seedMeta = (fake: FakeBrowser, daysAgo: number, extra: Partial<Meta> = {}) => {
  fake.local.set(Keys.meta, {
    schemaVersion: 1,
    installedAt: fake.clock - daysAgo * DAY_MS,
    flavor: "default",
    ...extra,
  } satisfies Meta);
};

const reminder = (fake: FakeBrowser) =>
  stored<{ dueSince: number; snoozedUntil?: number }>(fake, BgKeys.backupReminder);

describe("backup.exportHtml", () => {
  it("exports every workspace (tabs + saved links) and quick links; records the backup", async () => {
    const h = await setup({
      before: (fake) => {
        seedMeta(fake, 40);
        seedWorkspace(fake, "A", ["https://a.example/?q=1", "javascript:alert(1)"], {
          name: "Alpha & Co",
          resources: [
            { id: "l1", url: "https://link.example/#x", title: "Link", order: 0, addedAt: 1000 },
          ],
        });
        seedWorkspace(fake, "B", ["https://b.example/"], { name: "Beta" });
        fake.local.set(Keys.quicklinks, {
          items: [{ id: "q", url: "https://quick.example/", title: "Quick", order: 0 }],
          rev: 1,
        });
      },
    });
    expect(reminder(h.fake)).toEqual({ dueSince: h.fake.clock }); // init evaluated it
    const out = await h.ok("backup.exportHtml", {});
    expect(out.filename).toMatch(/^tabitat-\d{4}-\d{2}-\d{2}\.html$/);
    expect(out.html).toContain(">Alpha &amp; Co</H3>");
    expect(out.html).toContain(">Beta</H3>");
    expect(out.html).toContain('HREF="https://a.example/?q=1"');
    expect(out.html).toContain("<DT><H3>Saved links</H3>");
    expect(out.html).toContain('HREF="https://link.example/#x"');
    expect(out.html).toContain("<DT><H3>Quick links</H3>");
    expect(out.html).not.toContain("javascript:");
    expect(stored<Meta>(h.fake, Keys.meta)?.lastBackupAt).toBe(h.fake.clock);
    expect(reminder(h.fake)).toBeUndefined();

    const stripped = await h.ok("backup.exportHtml", { stripQuery: true });
    expect(stripped.html).toContain('HREF="https://a.example/"');
    expect(stripped.html).toContain('HREF="https://link.example/"');
  });

  it("backup.export also records lastBackupAt and clears the reminder", async () => {
    const h = await setup({ before: (fake) => seedMeta(fake, 40) });
    expect(reminder(h.fake)).toBeDefined();
    h.fake.advance(5000);
    await h.ok("backup.export", {});
    expect(stored<Meta>(h.fake, Keys.meta)?.lastBackupAt).toBe(h.fake.clock);
    expect(reminder(h.fake)).toBeUndefined();
    // the next daily check is not due any more
    h.fake.fireAlarm("backup-reminder");
    await settle(10);
    expect(reminder(h.fake)).toBeUndefined();
  });
});

describe("export labels", () => {
  it("uses chrome.i18n messages, falling back to English for empty ones", async () => {
    const h = await setup({
      windows: [["https://w1.example/"]],
      before: (fake) => {
        seedMeta(fake, 1);
        seedWorkspace(fake, "A", ["https://a.example/"], { name: "Alpha" });
        fake.local.set(Keys.quicklinks, {
          items: [{ id: "q", url: "https://quick.example/", title: "Quick", order: 0 }],
          rev: 1,
        });
        fake.messages.set("exportTitle", "Exportación");
        fake.messages.set("exportHeading", "Exportación de Tabitat");
        fake.messages.set("exportQuickLinks", "Enlaces rápidos");
        fake.messages.set("exportWindow", "Ventana");
        fake.messages.set("exportSessionHeading", "Sesión de Tabitat");
        fake.messages.set("exportSavedLinks", "  ");
      },
    });
    const all = await h.ok("backup.exportHtml", {});
    expect(all.html).toContain("<TITLE>Exportación</TITLE>");
    expect(all.html).toContain("<H1>Exportación de Tabitat — ");
    expect(all.html).toContain("<DT><H3>Enlaces rápidos</H3>");
    const { generation: gen } = await h.ok("session.snapshotNow", {});
    const ses = await h.ok("session.exportHtml", { generation: gen });
    expect(ses.html).toContain(`<H1>Sesión de Tabitat ${gen} — `);
  });
});

describe("session.exportHtml", () => {
  it("exports one generation, one folder per window; does not stamp; not_found otherwise", async () => {
    const h = await setup({
      windows: [["https://w1.example/?s=1"], ["https://w2.example/"]],
      before: (fake) => {
        seedMeta(fake, 1);
        seedWorkspace(fake, "A", ["https://w1.example/?s=1"], { name: "Alpha" });
      },
    });
    const first = h.fake.windowIds()[0] as number;
    h.fake.local.set(Keys.window(first), {
      activeWorkspaceId: "A",
      sessionEpoch: h.svc.ctx.epoch,
    } satisfies WindowState);
    const { generation } = await h.ok("session.snapshotNow", {});
    const out = await h.ok("session.exportHtml", { generation, stripQuery: true });
    expect(out.filename).toMatch(
      new RegExp(`^tabitat-session-${generation}-\\d{4}-\\d{2}-\\d{2}\\.html$`),
    );
    expect(out.html).toContain(">Alpha</H3>");
    expect(out.html).toContain(">Window 2</H3>");
    expect(out.html).toContain('HREF="https://w1.example/"');
    expect(out.html).toContain('HREF="https://w2.example/"');
    expect(stored<Meta>(h.fake, Keys.meta)?.lastBackupAt).toBeUndefined();
    expect(await h.rpc("session.exportHtml", { generation: 999 })).toMatchObject({
      ok: false,
      code: "not_found",
    });
  });
});

describe("backup reminder", () => {
  it("the daily alarm writes the record once due; snooze holds it; an expired snooze is dropped", async () => {
    const h = await setup({ before: (fake) => seedMeta(fake, 29) });
    expect(h.fake.alarms.get("backup-reminder")?.periodInMinutes).toBe(1440);
    expect(reminder(h.fake)).toBeUndefined();
    h.fake.advance(2 * DAY_MS);
    h.fake.fireAlarm("backup-reminder");
    await settle(10);
    const dueSince = h.fake.clock;
    expect(reminder(h.fake)).toEqual({ dueSince });

    await h.ok("reminder.snooze", { days: 7 });
    expect(reminder(h.fake)).toEqual({ dueSince, snoozedUntil: dueSince + 7 * DAY_MS });
    h.fake.advance(DAY_MS);
    h.fake.fireAlarm("backup-reminder");
    await settle(10);
    expect(reminder(h.fake)?.snoozedUntil).toBe(dueSince + 7 * DAY_MS);

    h.fake.advance(7 * DAY_MS);
    h.fake.fireAlarm("backup-reminder");
    await settle(10);
    expect(reminder(h.fake)).toEqual({ dueSince });
    expect(await h.rpc("reminder.snooze", { days: 0 })).toMatchObject({ code: "invalid" });
  });

  it("turning it off removes the record and the alarm; a new cadence re-evaluates now", async () => {
    const h = await setup({ before: (fake) => seedMeta(fake, 20) });
    expect(reminder(h.fake)).toBeUndefined();
    await h.ok("settings.update", { patch: { backupReminderDays: 7 } });
    expect(reminder(h.fake)).toEqual({ dueSince: h.fake.clock });
    await h.ok("settings.update", { patch: { backupReminderDays: 0 } });
    expect(reminder(h.fake)).toBeUndefined();
    expect(h.fake.alarms.has("backup-reminder")).toBe(false);
    // off: the alarm is not recreated by a restart, and init writes nothing
    await h.restart();
    expect(h.fake.alarms.has("backup-reminder")).toBe(false);
    expect(reminder(h.fake)).toBeUndefined();
    await h.ok("settings.update", { patch: { backupReminderDays: 10 } });
    expect(h.fake.alarms.has("backup-reminder")).toBe(true);
    expect(reminder(h.fake)).toBeDefined();
  });

  it("snooze is a no-op when the reminder is off, and creates no record when not due", async () => {
    const off = await setup({ before: (fake) => seedMeta(fake, 90, { lastBackupAt: undefined }) });
    expect(reminder(off.fake)).toEqual({ dueSince: off.fake.clock });
    await off.ok("settings.update", { patch: { backupReminderDays: 0 } });
    expect(reminder(off.fake)).toBeUndefined();
    await off.ok("reminder.snooze", { days: 7 }); // a stale queued snooze
    expect(reminder(off.fake)).toBeUndefined();
    // a record that somehow exists while off is removed
    off.fake.local.set(BgKeys.backupReminder, { dueSince: 1 });
    await off.ok("reminder.snooze", { days: 7 });
    expect(reminder(off.fake)).toBeUndefined();

    const fresh = await setup({ before: (fake) => seedMeta(fake, 5) });
    await fresh.ok("reminder.snooze", { days: 7 });
    expect(reminder(fresh.fake)).toBeUndefined();
  });

  it("snooze when due writes the record; turning off afterwards leaves nothing", async () => {
    const h = await setup({ before: (fake) => seedMeta(fake, 40) });
    const dueSince = h.fake.clock;
    expect(reminder(h.fake)).toEqual({ dueSince });
    await h.ok("reminder.snooze", { days: 3 });
    expect(reminder(h.fake)).toEqual({ dueSince, snoozedUntil: dueSince + 3 * DAY_MS });
    await h.ok("settings.update", { patch: { backupReminderDays: 0 } });
    expect(reminder(h.fake)).toBeUndefined();
    await h.ok("reminder.snooze", { days: 3 });
    expect(reminder(h.fake)).toBeUndefined();
  });

  it("recordBackup clears an existing record and tolerates a missing one", async () => {
    const h = await setup({ before: (fake) => seedMeta(fake, 40) });
    await h.ok("backup.export", {});
    expect(reminder(h.fake)).toBeUndefined();
    await h.ok("backup.export", {});
    expect(reminder(h.fake)).toBeUndefined();
  });

  it("a corrupt record is quarantined and rebuilt", async () => {
    const h = await setup({
      before: (fake) => {
        seedMeta(fake, 40);
        fake.local.set(BgKeys.backupReminder, { dueSince: "yesterday" });
      },
    });
    expect(reminder(h.fake)).toEqual({ dueSince: h.fake.clock });
    expect(stored(h.fake, BgKeys.corrupt(BgKeys.backupReminder))).toBeDefined();
  });
});
