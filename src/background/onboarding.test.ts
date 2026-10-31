import { describe, expect, it } from "vitest";
import type { Meta } from "../core/model/types";
import { Keys } from "../core/model/types";
import { ONBOARDING_PATH, openOnboardingIfNew } from "./onboarding";
import { setup, stored } from "./testing/harness";

describe("openOnboardingIfNew", () => {
  it("opens the tour on install when meta.onboardedAt is unset, after init", async () => {
    const h = await setup({ skipInit: true });
    const opened: string[] = [];
    const open = async (p: string) => {
      // init has run by the time the tab opens: meta exists
      expect(stored<Meta>(h.fake, Keys.meta)).toBeDefined();
      opened.push(p);
    };
    expect(await openOnboardingIfNew(h.svc, "install", open)).toBe(true);
    expect(opened).toEqual([ONBOARDING_PATH]);
  });

  it("never opens on update, browser update or shared module update", async () => {
    const h = await setup();
    const opened: string[] = [];
    const open = async (p: string) => opened.push(p);
    for (const reason of ["update", "chrome_update", "shared_module_update"]) {
      expect(await openOnboardingIfNew(h.svc, reason, open)).toBe(false);
    }
    expect(opened).toEqual([]);
  });

  it("does not open again once the tour was completed", async () => {
    const h = await setup();
    await h.ok("system.onboarded", {});
    const opened: string[] = [];
    expect(await openOnboardingIfNew(h.svc, "install", async (p) => opened.push(p))).toBe(false);
    expect(opened).toEqual([]);
  });
});
