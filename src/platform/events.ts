/**
 * Event and UI-shell ports used by background services. Not part of the fixed `Ports` contract
 * (platform/types.ts); background services take `BgPorts` = Ports + these.
 * Implementations: platform/chrome.ts (real) and platform/fake.ts (tests).
 */
import type { LiveGroup, LiveTab } from "../core/ops/types";
import type { Ports } from "./types";

export type Unsubscribe = () => void;

/** Subset of chrome.tabs.onUpdated changeInfo we care about. */
export interface TabChangeInfo {
  url?: string;
  title?: string;
  pinned?: boolean;
  groupId?: number;
  favIconUrl?: string;
  status?: string;
  discarded?: boolean;
  audible?: boolean;
}

export interface TabRemoveInfo {
  windowId: number;
  isWindowClosing: boolean;
}

/** The tab passed to chrome.commands.onCommand (may be absent). */
export interface CommandTab {
  id?: number;
  windowId: number;
}

/**
 * Browser events. Every `onX` registers synchronously (MV3: listeners must be attached at the
 * service worker's top level) and returns an unsubscribe function.
 */
export interface EventsPort {
  onTabCreated(cb: (tab: LiveTab) => void): Unsubscribe;
  onTabUpdated(cb: (tabId: number, change: TabChangeInfo, tab: LiveTab) => void): Unsubscribe;
  onTabRemoved(cb: (tabId: number, info: TabRemoveInfo) => void): Unsubscribe;
  onTabMoved(cb: (tabId: number, info: { windowId: number }) => void): Unsubscribe;
  onTabActivated(cb: (info: { tabId: number; windowId: number }) => void): Unsubscribe;
  onTabAttached(cb: (tabId: number, info: { newWindowId: number }) => void): Unsubscribe;
  onTabDetached(cb: (tabId: number, info: { oldWindowId: number }) => void): Unsubscribe;
  /** `tabs.discard` (and prerendering) replace a tab id: the old id is gone for good (spike S11). */
  onTabReplaced(cb: (addedTabId: number, removedTabId: number) => void): Unsubscribe;
  /** Group created/updated/moved/removed. */
  onGroupUpdated(cb: (group: LiveGroup & { windowId: number }) => void): Unsubscribe;
  onWindowCreated(cb: (windowId: number) => void): Unsubscribe;
  onWindowRemoved(cb: (windowId: number) => void): Unsubscribe;
  onAlarm(cb: (name: string) => void): Unsubscribe;
  onCommand(cb: (command: string, tab?: CommandTab) => void): Unsubscribe;
}

/** Browser UI affordances (action badge, notifications, popup, side panel). */
export interface ShellPort {
  setBadge(tabId: number, text: string, color?: string): Promise<void>;
  notify(id: string, title: string, message: string): Promise<void>;
  /**
   * Opens the action popup. Must be called synchronously inside the user-gesture handler (never
   * after an await). Returns false when the API is unavailable.
   */
  openPopup(): boolean;
  /** Opens the side panel. Same synchronous-gesture rule as openPopup (spike S10). */
  openSidePanel(windowId: number): boolean;
}

export interface BgPorts extends Ports {
  events: EventsPort;
  shell: ShellPort;
}
