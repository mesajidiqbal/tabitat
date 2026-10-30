/**
 * Typed RPC contract between UI surfaces and the service worker (ADR-003, §7).
 * UI calls `send("workspace.switch", {...})`; the worker's CommandRouter validates the
 * payload (valibot), runs the handler in its lane, and replies with an Envelope.
 */
import type {
  BackupFile,
  Color,
  Note,
  PomodoroState,
  QuickLink,
  SavedLink,
  SavedTab,
  Scope,
  Settings,
  SwitchOp,
  Todo,
  WorkspaceId,
  WorkspaceMeta,
} from "../core/model/types";

export type RpcErrorCode = "conflict" | "busy" | "not_found" | "invalid" | "limit" | "internal";

export type Envelope<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      code: RpcErrorCode;
      message: string;
      retryable: boolean;
      /** Optional structured detail, e.g. `{ partial: true, applied: [...] }` for an import. */
      details?: Record<string, unknown>;
    };

export interface ImportReport {
  workspaces: number;
  todos: number;
  notes: number;
  quicklinks: number;
  warnings: string[];
}

export interface Commands {
  "workspace.create": {
    in: { name: string; color: Color; fromWindowId?: number };
    out: WorkspaceMeta;
  };
  "workspace.update": {
    in: {
      id: WorkspaceId;
      patch: Partial<Pick<WorkspaceMeta, "name" | "color" | "emoji">>;
      expectedRev?: number;
    };
    out: WorkspaceMeta;
  };
  "workspace.reorder": { in: { ids: WorkspaceId[] }; out: null };
  "workspace.delete": { in: { id: WorkspaceId }; out: { trashId: string } };
  "workspace.switch": {
    in: { windowId: number; workspaceId: WorkspaceId };
    /**
     * `possibleDuplicates`: directly created tabs (chrome://, our own pages) that may have been
     * created twice after a worker restart; both copies are left open (never auto-closed).
     */
    out: { skipped: SavedTab[]; possibleDuplicates?: SavedTab[] };
  };
  "workspace.open": { in: { workspaceId: WorkspaceId }; out: { windowId: number } };
  "workspace.next": {
    in: { windowId: number; direction: 1 | -1 };
    out: { workspaceId: WorkspaceId | null };
  };
  "link.add": { in: { workspaceId: WorkspaceId; url: string; title: string }; out: SavedLink };
  "link.remove": { in: { workspaceId: WorkspaceId; linkId: string }; out: { trashId: string } };
  "tabs.park": { in: { tabId: number; workspaceId: WorkspaceId }; out: SavedLink };
  "tabs.suspendOthers": { in: { windowId: number }; out: number };
  "tabs.closeDuplicates": { in: { windowId?: number }; out: number };
  "session.restore": { in: { generation: number }; out: { windowId: number } };
  "session.snapshotNow": { in: Record<string, never>; out: { generation: number } };
  "backup.export": { in: Record<string, never>; out: BackupFile };
  "backup.import": { in: { file: unknown; mode: "replace" | "merge" }; out: ImportReport };
  "todo.set": { in: { scope: Scope; items: Todo[]; expectedRev?: number }; out: { rev: number } };
  "note.set": { in: { scope: Scope; content: string; expectedRev?: number }; out: Note };
  "quicklink.set": { in: { items: QuickLink[]; expectedRev?: number }; out: { rev: number } };
  "settings.update": {
    in: { patch: Partial<Omit<Settings, "rev">>; expectedRev?: number };
    out: Settings;
  };
  "trash.restore": { in: { trashId: string }; out: null };
  "trash.purge": { in: { trashId?: string }; out: number };
  "pomodoro.start": { in: Record<string, never>; out: PomodoroState };
  "pomodoro.stop": { in: Record<string, never>; out: null };
  "pomodoro.skip": { in: Record<string, never>; out: PomodoroState | null };
  "op.status": { in: { windowId: number }; out: SwitchOp | null };
  "system.ping": {
    in: Record<string, never>;
    /** `degraded`: init failed (read-only mode, retried on the next message); `error` says why. */
    out: { epoch: string; ready: true; degraded?: boolean; error?: string };
  };
}

export type CommandType = keyof Commands;
export type CommandIn<T extends CommandType> = Commands[T]["in"];
export type CommandOut<T extends CommandType> = Commands[T]["out"];

export interface RpcRequest<T extends CommandType = CommandType> {
  kind: "tabitat.rpc";
  requestId: string;
  type: T;
  payload: CommandIn<T>;
}

export type RpcResponse<T extends CommandType = CommandType> = Envelope<CommandOut<T>>;
