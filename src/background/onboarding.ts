/**
 * First-install welcome tour (docs/PHASE5.md §1). Runs from `runtime.onInstalled` with
 * `reason === "install"` only (never on update or reload), after init resolved, and opens
 * `onboarding.html` unless `meta.onboardedAt` is already set.
 */
import type { Services } from "./services";

export const ONBOARDING_PATH = "/onboarding.html";

export async function openOnboardingIfNew(
  services: Pick<Services, "init" | "repo">,
  reason: string,
  openTab: (path: string) => Promise<unknown>,
): Promise<boolean> {
  if (reason !== "install") return false;
  await services.init();
  const meta = await services.repo.getMeta();
  if (meta?.onboardedAt !== undefined) return false;
  await openTab(ONBOARDING_PATH);
  return true;
}
