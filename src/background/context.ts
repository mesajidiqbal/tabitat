/** Shared per-worker context for background services. Holds no durable state. */
import type { WorkspaceMeta, WorkspaceTabs } from "../core/model/types";
import { Keys } from "../core/model/types";
import type { SnapshotOptions } from "../core/ops/snapshot";
import type { LiveWindow } from "../core/ops/types";
import { isDangerousUrl } from "../core/ops/url";
import type { BgPorts } from "../platform/events";
import type { LaneQueue } from "./lanes";
import type { Logger, Repository } from "./repository";

export const PLACEHOLDER_PATH = "/suspended.html";

/**
 * Drops favicon URLs the record schemas reject (data:, javascript:): Chrome often reports
 * data: favicons, and a snapshot containing one would fail validation on the next read.
 */
export function sanitizeWindow(win: LiveWindow): LiveWindow {
  if (!win.tabs.some((t) => t.favIconUrl !== undefined && isDangerousUrl(t.favIconUrl))) return win;
  return {
    ...win,
    tabs: win.tabs.map((t) => {
      if (t.favIconUrl === undefined || !isDangerousUrl(t.favIconUrl)) return t;
      const { favIconUrl: _drop, ...rest } = t;
      return rest;
    }),
  };
}

export class BgContext {
  /** Browser-session epoch; set by init before any handler runs. */
  epoch = "";
  readonly placeholderBase: string;

  constructor(
    readonly ports: BgPorts,
    readonly repo: Repository,
    readonly lanes: LaneQueue,
    readonly directSchemes: string[],
    readonly log: Logger,
  ) {
    this.placeholderBase = ports.runtime.getURL(PLACEHOLDER_PATH);
  }

  /** windows.get + sanitizeWindow. */
  async getWindow(windowId: number): Promise<LiveWindow | null> {
    const win = await this.ports.windows.get(windowId);
    return win ? sanitizeWindow(win) : null;
  }

  async getAllWindows(): Promise<LiveWindow[]> {
    return (await this.ports.windows.getAll()).map(sanitizeWindow);
  }

  snapshotOptions(): SnapshotOptions {
    return {
      placeholderBase: this.placeholderBase,
      now: this.ports.now(),
      newId: this.ports.newId,
      directSchemes: this.directSchemes,
    };
  }

  /**
   * Creates the implicit Unsorted workspace for a window and makes it the window's active
   * workspace, in one storage write. Caller must hold lanes window:<id> and key:ws:index.
   */
  async createUnsorted(windowId: number, tabs: WorkspaceTabs | null): Promise<WorkspaceMeta> {
    const now = this.ports.now();
    const id = this.ports.newId();
    const meta: WorkspaceMeta = {
      id,
      name: `Unsorted (window ${windowId})`,
      color: "grey",
      kind: "unsorted",
      windowHint: windowId,
      resources: [],
      createdAt: now,
      updatedAt: now,
      rev: 1,
    };
    const index = await this.repo.getWorkspaceIndex();
    await this.repo.setMany({
      [Keys.wsMeta(id)]: meta,
      [Keys.wsTabs(id)]: tabs ?? { tabs: [], updatedAt: now, rev: 1 },
      [Keys.wsIndex]: [...index, id],
      [Keys.window(windowId)]: { activeWorkspaceId: id, sessionEpoch: this.epoch },
    });
    return meta;
  }
}
