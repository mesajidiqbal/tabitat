/** Bookmarks import (docs/PHASE3.md §6): permission, folder picker, destination, import. */
import { useEffect, useMemo, useState } from "preact/hooks";
import { type Color, Keys } from "@/core/model/types";
import { t } from "@/i18n";
import { send } from "@/messaging/client";
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
  type FolderNode,
  importCalls,
  previewImport,
  setFolderChecked,
  suggestedWorkspaceName,
} from "./bookmarks-tree";
import { warningLines } from "./bookmarks-warnings";
import { errorLine } from "./errors";
import { FolderTree } from "./FolderTree";
import { Group, Section } from "./fields";
import { ImportDestination } from "./ImportDestination";
import { ImportFooter } from "./ImportFooter";
import s from "./options.module.css";

/** URLs of the stored quick links (read defensively: the page reads storage directly). */
const quickUrls = (raw: unknown): string[] => {
  const items = (raw as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items)) return [];
  return items.flatMap((x) => {
    const url = (x as { url?: unknown } | null)?.url;
    return typeof url === "string" ? [url] : [];
  });
};

export function BookmarksSection() {
  const quick = useStorageKey(Keys.quicklinks).value;
  const existing = useMemo(() => quickUrls(quick), [quick]);
  const [tree, setTree] = useState<FolderNode[] | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [dest, setDest] = useState<DestinationKind>("quicklinks");
  const [typedName, setTypedName] = useState<string | null>(null);
  const [color, setColor] = useState<Color>("blue");
  const [line, setLine] = useState<Line>(null);
  const [warnings, setWarnings] = useState<string[][]>([]);
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
  const fallbackName = t("optBmImportedName");
  const name = typedName ?? suggestedWorkspaceName(tree ?? [], selection, fallbackName);
  const plan = useMemo(
    () => importCalls(tree ?? [], selection, { dest, name, color, fallbackName }),
    [tree, selection, dest, name, color, fallbackName],
  );
  const preview = useMemo(
    () => previewImport(plan.calls, collected.entries.length, existing, plan.droppedFolders),
    [plan, collected, existing],
  );
  const canImport = !busy && plan.calls.length > 0 && (dest !== "workspace" || name.trim() !== "");

  const run = async () => {
    setBusy(true);
    setLine(null);
    setWarnings([]);
    let added = 0;
    let skipped = collected.entries.length;
    const got: string[][] = [];
    if (plan.droppedFolders > 0) got.push([`workspaces_limit:${plan.droppedFolders}`]);
    try {
      for (const call of plan.calls) {
        const r = await send("import.bookmarks", call);
        added += r.added;
        got.push(r.warnings);
      }
      skipped = Math.max(0, skipped - added);
      setLine({ ok: true, text: t("optBmResult", [added, skipped]) });
      setImported(true);
    } catch (e) {
      fail(e);
      if (added > 0) setImported(true);
    }
    setWarnings(got);
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
              preview={preview}
              shortened={plan.shortened}
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
            {warningLines(warnings).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
      </Group>
    </Section>
  );
}
