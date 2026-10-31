// biome-ignore-all lint/a11y/useSemanticElements: ARIA grid of div rows (flex rows and card layouts; no table elements)
/**
 * Workspace grid row (popup row / side-panel and dashboard card): a primary cell (holds the
 * roving tabindex) and an actions cell with the "…" menu. Click or Enter / Space switches; the
 * menu (also Shift+F10 / ContextMenu) opens in a new window, renames (F2), recolours, deletes
 * (Delete). In a list ArrowRight moves to the menu button, ArrowLeft back; cards sit in a
 * two-dimensional grid (the list's `useRoving` has `columns`), so there the arrows move between
 * cards and the menu opens with Shift+F10 / ContextMenu (or a click on its button). Finishing or
 * cancelling a rename with Enter / Escape returns focus to the primary cell.
 */
import { useRef, useState } from "preact/hooks";
import type { WorkspaceMeta } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt, deleteWorkspace, switchTo } from "../actions";
import { relTime, unsortedDetail } from "../format";
import type { RovingItem } from "../hooks/useRoving";
import { IconMore } from "../icons";
import { store } from "../store";
import { colorVar } from "../theme";
import { ColorSwatches } from "./ColorSwatches";
import c from "./controls.module.css";
import { ActionsCell, focusActions } from "./GridCells";
import { Kbd } from "./Kbd";
import { Menu } from "./Menu";
import s from "./rows.module.css";

export interface WorkspaceRowProps {
  meta: WorkspaceMeta;
  item: RovingItem;
  /** 1-based position in the grid (aria-rowindex). */
  rowIndex?: number;
  tabCount: number;
  savedAt?: number | undefined;
  active: boolean;
  /** Open in another window (click focuses that window). */
  elsewhere: boolean;
  shortcut?: number | undefined;
  disabled: boolean;
  card?: boolean;
}

export function WorkspaceRow(p: WorkspaceRowProps) {
  const { meta } = p;
  const [renaming, setRenaming] = useState(false);
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  const cell = useRef<HTMLDivElement | null>(null);
  const unsorted = meta.kind === "unsorted";
  const name = !unsorted ? meta.name : p.active ? t("unsorted") : t("unsortedOther");
  const update = (patch: { name?: string; color?: WorkspaceMeta["color"] }) =>
    attempt(() => send("workspace.update", { id: meta.id, patch, expectedRev: meta.rev }));
  // The Unsorted workspace of a live window is that window's own tabs: not deletable while open.
  const deletable = !(unsorted && (p.active || p.elsewhere));
  const open = () => !p.disabled && !renaming && void switchTo(meta.id);
  /** Ends the rename; focus goes back to the primary cell if it is still on the input. */
  const endRename = (input: HTMLElement) => {
    const keep = document.activeElement === input;
    setRenaming(false);
    if (keep) cell.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && !renaming) {
      const k = e.key;
      if (k === "Enter" || k === " ") open();
      // While a switch runs (disabled) rename / delete keys are swallowed, not acted on.
      else if (k === "F2") {
        if (!p.disabled) setRenaming(true);
      } else if (k === "Delete") {
        if (deletable && !p.disabled) void deleteWorkspace(meta.id, name);
      } else if (k === "ContextMenu" || (k === "F10" && e.shiftKey)) menuBtn.current?.click();
      else if (
        k === "ArrowRight" &&
        !p.card &&
        !e.shiftKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.metaKey
      )
        focusActions(e.currentTarget as HTMLElement);
      else return p.item.onKeyDown(e);
      e.preventDefault();
      return;
    }
    p.item.onKeyDown(e);
  };

  const count = plural(p.tabCount, "tabsOne", "tabsMany");
  const preview = p.card && unsorted && !p.active;
  const details = [preview ? unsortedDetail(store.wsTabs.value[meta.id]?.tabs, count) : count];
  if (p.savedAt) details.push(relTime(p.savedAt));
  if (p.elsewhere && p.card) details.push(t("openElsewhere"));
  const keys = [
    ...(p.shortcut ? [String(p.shortcut)] : []),
    "F2",
    ...(deletable ? ["Delete"] : []),
    "Shift+F10",
    "ContextMenu",
  ];
  return (
    // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: focus and keys live on the primary cell; the row click is the pointer shortcut
    <div
      role="row"
      aria-rowindex={p.rowIndex}
      aria-selected={p.active}
      aria-disabled={p.disabled ? "true" : undefined}
      class={[s.row, p.card && s.card, p.active && !p.card && s.current].filter(Boolean).join(" ")}
      style={{ "--dot": colorVar(meta.color) }}
      onClick={open}
    >
      <div
        role="gridcell"
        class={s.cell}
        aria-keyshortcuts={keys.join(" ")}
        tabIndex={p.item.tabIndex}
        ref={(el) => {
          cell.current = el;
          p.item.ref(el);
        }}
        onFocus={p.item.onFocus}
        onKeyDown={onKeyDown}
      >
        <span class={`${s.dot} ${p.active ? s.dotOn : ""}`} />
        <span class={s.text}>
          {renaming ? (
            <input
              class={c.input}
              aria-label={t("rename")}
              // biome-ignore lint/a11y/noAutofocus: rename was just requested
              autoFocus
              defaultValue={unsorted ? "" : meta.name}
              maxLength={200}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => setRenaming(false)}
              onKeyDown={(e) => {
                e.stopPropagation();
                const input = e.currentTarget;
                const v = input.value.trim();
                // Enter / Escape hand focus back to the row (the input unmounts); a blur to
                // elsewhere just ends the rename (C2.2).
                if (e.key === "Enter" && v) void update({ name: v }).then(() => endRename(input));
                if (e.key === "Escape") endRename(input);
              }}
            />
          ) : (
            <span class={`${s.title} ${p.active ? s.strong : ""}`}>
              {name}
              {p.active && <span class="sr-only"> ({t("activeHere")})</span>}
            </span>
          )}
          {p.card && <span class={s.sub}>{details.join(" · ")}</span>}
        </span>
        {p.elsewhere && !p.card && <span class={s.tag}>{t("openElsewhere")}</span>}
        {!p.card && <span class={s.meta}>{details.join(" · ")}</span>}
        {p.shortcut !== undefined && !p.card && <Kbd>{p.shortcut}</Kbd>}
      </div>
      <ActionsCell item={p.item}>
        <Menu
          label={t("workspaceActions", name)}
          trigger={<IconMore />}
          triggerClass={c.iconBtn}
          triggerRef={menuBtn}
          tabIndex={-1}
          returnFocus={() => cell.current?.focus()}
          items={[
            {
              label: t("openInNewWindow"),
              disabled: p.disabled,
              onSelect: () => void attempt(() => send("workspace.open", { workspaceId: meta.id })),
            },
            {
              label: unsorted ? t("nameWorkspace") : t("rename"),
              hint: <Kbd>F2</Kbd>,
              disabled: p.disabled,
              onSelect: () => setRenaming(true),
            },
            ...(deletable
              ? [
                  {
                    label: t("delete"),
                    danger: true,
                    hint: <Kbd>Del</Kbd>,
                    disabled: p.disabled,
                    onSelect: () => void deleteWorkspace(meta.id, name),
                  },
                ]
              : []),
          ]}
          extra={(close) => (
            <ColorSwatches
              inMenu
              disabled={p.disabled}
              value={meta.color}
              onChange={(color) => {
                close();
                void update({ color });
              }}
            />
          )}
        />
      </ActionsCell>
    </div>
  );
}
