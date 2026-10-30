/**
 * Ports over chrome.* used by background services. Implemented by platform/chrome-*.ts,
 * faked in tests. Keep these minimal and promise-based.
 */
import type { Color } from "../core/model/types";
import type { LiveGroup, LiveTab, LiveWindow } from "../core/ops/types";

export interface StoragePort {
  get<T>(key: string): Promise<T | undefined>;
  getMany(keys: string[]): Promise<Record<string, unknown>>;
  getAll(): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  /** Fires for every change batch; `area` is "local" | "session" | "sync". */
  onChanged(
    cb: (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void,
  ): () => void;
}

export interface TabsPort {
  query(filter: {
    windowId?: number;
    active?: boolean;
    pinned?: boolean;
    discarded?: boolean;
    audible?: boolean;
  }): Promise<LiveTab[]>;
  get(tabId: number): Promise<LiveTab | null>;
  create(spec: {
    windowId: number;
    url: string;
    index?: number;
    active: boolean;
    pinned?: boolean;
  }): Promise<LiveTab>;
  remove(tabIds: number[]): Promise<void>;
  update(tabId: number, props: { active?: boolean; url?: string; pinned?: boolean }): Promise<void>;
  discard(tabId: number): Promise<void>;
  group(tabIds: number[], windowId: number): Promise<number>;
  updateGroup(
    groupId: number,
    props: { title?: string; color?: Color; collapsed?: boolean },
  ): Promise<void>;
  getGroups(windowId: number): Promise<LiveGroup[]>;
}

export interface WindowsPort {
  getAll(): Promise<LiveWindow[]>;
  get(windowId: number): Promise<LiveWindow | null>;
  create(spec: { url?: string | string[]; focused?: boolean }): Promise<LiveWindow>;
}

export interface AlarmsPort {
  create(
    name: string,
    info: { periodInMinutes?: number; delayInMinutes?: number; when?: number },
  ): Promise<void>;
  clear(name: string): Promise<void>;
  getAll(): Promise<string[]>;
}

export interface RuntimePort {
  getURL(path: string): string;
  /** Extension id; used for placeholder detection. */
  id: string;
}

export interface Ports {
  local: StoragePort;
  session: StoragePort;
  tabs: TabsPort;
  windows: WindowsPort;
  alarms: AlarmsPort;
  runtime: RuntimePort;
  now: () => number;
  newId: () => string;
}
