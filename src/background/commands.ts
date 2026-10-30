/**
 * chrome.commands (keyboard shortcuts). UI-opening commands run synchronously inside the
 * listener, before any await, because sidePanel.open/action.openPopup need the user gesture
 * (spike S10). The others go through the CommandRouter (lanes, busy, validation).
 */
import type { CommandType, Envelope } from "../messaging/commands";
import type { CommandTab, ShellPort } from "../platform/events";

/** chrome.windows.WINDOW_ID_CURRENT */
const WINDOW_ID_CURRENT = -2;

export interface ShortcutDeps {
  shell: ShellPort;
  dispatch(msg: unknown): Promise<Envelope<unknown>>;
  ready(): Promise<void>;
  newId(): string;
  log: { warn(...a: unknown[]): void };
}

export class Shortcuts {
  constructor(private readonly deps: ShortcutDeps) {}

  /** Synchronous entry point for chrome.commands.onCommand. Returns the async tail (tests). */
  handle(command: string, tab?: CommandTab): Promise<void> {
    const windowId = tab?.windowId ?? WINDOW_ID_CURRENT;
    switch (command) {
      case "toggle-side-panel":
        this.deps.shell.openSidePanel(windowId);
        return Promise.resolve();
      case "open-search":
        if (!this.deps.shell.openPopup()) this.deps.shell.openSidePanel(windowId);
        return Promise.resolve();
      case "next-workspace":
        return this.rpc("workspace.next", tab, (w) => ({ windowId: w, direction: 1 }));
      case "prev-workspace":
        return this.rpc("workspace.next", tab, (w) => ({ windowId: w, direction: -1 }));
      case "suspend-other-tabs":
        return this.rpc("tabs.suspendOthers", tab, (w) => ({ windowId: w }));
      default:
        return Promise.resolve();
    }
  }

  private async rpc(
    type: CommandType,
    tab: CommandTab | undefined,
    payload: (windowId: number) => unknown,
  ): Promise<void> {
    if (!tab) return;
    await this.deps.ready();
    const env = await this.deps.dispatch({
      kind: "tabitat.rpc",
      requestId: this.deps.newId(),
      type,
      payload: payload(tab.windowId),
    });
    if (!env.ok) this.deps.log.warn("[tabitat] shortcut failed", type, env.code, env.message);
  }
}
