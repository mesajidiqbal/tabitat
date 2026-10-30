/** Action badge: the active workspace's emoji or initial. Badge text is per tab in Chrome, so it is set on the active tab. */
import type { WorkspaceMeta } from "../core/model/types";
import type { BgContext } from "./context";

export function badgeText(meta: WorkspaceMeta | null): string {
  if (!meta || meta.kind === "unsorted") return "";
  if (meta.emoji) return meta.emoji;
  return [...meta.name.trim()][0]?.toUpperCase() ?? "";
}

export class Badge {
  constructor(private readonly ctx: BgContext) {}

  private async metaFor(windowId: number): Promise<WorkspaceMeta | null> {
    const st = await this.ctx.repo.getWindowState(windowId);
    return st?.activeWorkspaceId ? this.ctx.repo.getWorkspaceMeta(st.activeWorkspaceId) : null;
  }

  async refreshTab(tabId: number, windowId: number): Promise<void> {
    const meta = await this.metaFor(windowId);
    await this.ctx.ports.shell.setBadge(tabId, badgeText(meta), meta?.color);
  }

  async refreshWindow(windowId: number): Promise<void> {
    const meta = await this.metaFor(windowId);
    const active = await this.ctx.ports.tabs.query({ windowId, active: true });
    for (const t of active) await this.ctx.ports.shell.setBadge(t.id, badgeText(meta), meta?.color);
  }
}
