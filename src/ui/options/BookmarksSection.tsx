/** Bookmarks import (docs/PHASE3.md §6): permission, folder picker, destination, import. */
import { useEffect, useMemo, useState } from "preact/hooks";
import { type Color, Keys } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
import type { ImportTarget } from "@/messaging/commands";
import c from "../components/controls.module.css";
import { useStorageKey } from "../hooks/useStorageKey";
import { type Line, LineView } from "./actions";
import {
  bookmarksApiAvailable,
  hasBookmarksPermission,
  loadFolders,
  removeBookmarksPermission,
  requestBookmarksPermission,
} from "./bookmarks-api";
import {
  collectSelection,
  type DestinationKind,
  defaultExpanded,
  destinationOverflow,
  type FolderNode,
  setFolderChecked,
  suggestedWorkspaceName,
} from "./bookmarks-tree";
import { errorLine } from "./errors";
import { FolderTree } from "./FolderTree";
import { Group, Section } from "./fields";
import { ImportDestination } from "./ImportDestination";
import { ImportFooter } from "./ImportFooter";
import s from "./options.module.css";

const quickCount = (raw: unknown): number => {
  const items = (raw as { items?: unknown } | undefined)?.items;
  return Array.isArray(items) ? items.length : 0;
};

export function BookmarksSection() {
  const existing = quickCount(useStorageKey(Keys.quicklinks).value);
  const [tree, setTree] = useState<FolderNode[] | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dest, setDest] = useState<DestinationKind>("quicklinks");
  const [typedName, setTypedName] = useState<string | null>(null);
  const [color, setColor] = useState<Color>("blue");
  const [line, setLine] = useState<Line>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [imported, setImported] = useState(false);

  const fail = (e: unknown) => {
    const err = errorLine(e);
    setLine({ ok: false, text: err.text, detail: err.detail });
  };
  const open = async () => {
    if (!bookmarksApiAvailable()) return setLine({ ok: false, text: t("optBmUnavailable") });
    try {
      const folders = await loadFolders();
      setTree(folders);
      setExpanded(defaultExpanded(folders));
      setSelection(new Set());
    } catch (e) {
      setLine({ ok: false, text: t("optBmLoadFailed"), detail: errorLine(e).detail });
    }
  };
  // Already granted earlier (or in another tab): skip the permission prompt.
  useEffect(() => {
    void hasBookmarksPermission().then(
      (ok) => ok && void open(),
      () => undefined,
    );
  }, []);

  const choose = async () => {
    setLine(null);
    let ok = false;
    try {
      ok = await requestBookmarksPermission(); // first await: keeps the click's user gesture
    } catch (e) {
      return fail(e);
    }
    if (!ok) return setLine({ ok: false, text: t("optBmDenied") });
    await open();
  };

  const collected = useMemo(() => collectSelection(tree ?? [], selection), [tree, selection]);
  const name = typedName ?? suggestedWorkspaceName(tree ?? [], selection);
  const overflow = destinationOverflow(dest, collected.entries.length, existing);
  const canImport =
    !busy && collected.entries.length > 0 && (dest !== "workspace" || name.trim() !== "");

  const run = async () => {
    const target: ImportTarget =
      dest === "quicklinks"
        ? { kind: "quicklinks" }
        : dest === "workspace"
          ? { kind: "workspace", name: name.trim(), color }
          : { kind: "workspacePerFolder", color };
    setBusy(true);
    setLine(null);
    try {
      const r = await send("import.bookmarks", { entries: collected.entries, target });
      setLine({ ok: true, text: t("optBmResult", [r.added, r.skipped]) });
      setWarnings(r.warnings);
      setImported(true);
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };
  const drop = async () => {
    try {
      await removeBookmarksPermission();
      setTree(null);
      setImported(false);
      setWarnings([]);
      setLine({ ok: true, text: t("optBmPermRemoved") });
    } catch (e) {
      fail(e);
    }
  };

  return (
    <Section id="bookmarks" title={t("optBookmarks")} lead={t("optBmLead")}>
      <Group>
        {tree === null ? (
          <div class={s.row}>
            <button type="button" class={c.btn} onClick={() => void choose()}>
              {t("optBmChoose")}
            </button>
          </div>
        ) : (
          <>
            {tree.length === 0 ? (
              <p class={s.hint}>{t("optBmEmpty")}</p>
            ) : (
              <FolderTree
                nodes={tree}
                selection={selection}
                expanded={expanded}
                onSelect={(id, on) => setSelection((sel) => setFolderChecked(tree, sel, id, on))}
                onExpand={(id) =>
                  setExpanded((ex) => {
                    const next = new Set(ex);
                    if (!next.delete(id)) next.add(id);
                    return next;
                  })
                }
              />
            )}
            <ImportDestination
              dest={dest}
              onDest={setDest}
              name={name}
              onName={setTypedName}
              color={color}
              onColor={setColor}
            />
            <ImportFooter
              collected={collected}
              overflow={overflow}
              canImport={canImport}
              busy={busy}
              imported={imported}
              onImport={() => void run()}
              onRemovePermission={() => void drop()}
            />
          </>
        )}
        <LineView line={line} />
        {warnings.length > 0 && (
          <ul class={s.hint}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </Group>
    </Section>
  );
}
