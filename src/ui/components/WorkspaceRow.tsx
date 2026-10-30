/**
 * Workspace option (popup row / side-panel card). Click or Enter switches; "…" menu (also
 * Shift+F10 / ContextMenu) opens in a new window, renames (F2), recolours, deletes (Delete).
 */
import { useRef, useState } from "preact/hooks";
import type { WorkspaceMeta } from "@/core/model/types";
import { plural, t } from "@/i18n";
import { send } from "@/messaging/client";
import { attempt, deleteWorkspace, switchTo } from "../actions";
import { relTime } from "../format";
import type { RovingItem } from "../hooks/useRoving";
import { IconMore } from "../icons";
import { colorVar } from "../theme";
import { ColorSwatches } from "./ColorSwatches";
import c from "./controls.module.css";
import { Kbd } from "./Kbd";
import { Menu } from "./Menu";
import s from "./rows.module.css";

export interface WorkspaceRowProps {
  meta: WorkspaceMeta;
  item: RovingItem;
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
  const unsorted = meta.kind === "unsorted";
  const name = !unsorted ? meta.name : p.active ? t("unsorted") : t("unsortedOther");
  const update = (patch: { name?: string; color?: WorkspaceMeta["color"] }) =>
    attempt(() => send("workspace.update", { id: meta.id, patch, expectedRev: meta.rev }));
  const open = () => !p.disabled && !renaming && void switchTo(meta.id);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && !renaming) {
      const k = e.key;
      if (k === "Enter" || k === " ") open();
      else if (k === "F2") setRenaming(true);
      else if (k === "Delete") void deleteWorkspace(meta.id, name);
      else if (k === "ContextMenu" || (k === "F10" && e.shiftKey)) menuBtn.current?.click();
      else return p.item.onKeyDown(e);
      e.preventDefault();
      return;
    }
    p.item.onKeyDown(e);
  };

  const details = [plural(p.tabCount, "tabsOne", "tabsMany")];
  if (p.savedAt && !p.card) details.push(relTime(p.savedAt));
  if (p.elsewhere && p.card) details.push(t("openElsewhere"));
  return (
    <div
      role="option"
      aria-selected={p.active}
      aria-disabled={p.disabled ? "true" : undefined}
      aria-keyshortcuts={p.shortcut ? String(p.shortcut) : undefined}
      class={[s.row, p.card && s.card, p.active && !p.card && s.current].filter(Boolean).join(" ")}
      style={{ "--dot": colorVar(meta.color) }}
      tabIndex={p.item.tabIndex}
      ref={p.item.ref}
      onFocus={p.item.onFocus}
      onKeyDown={onKeyDown}
      onClick={open}
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
              const v = e.currentTarget.value.trim();
              if (e.key === "Enter" && v) void update({ name: v }).then(() => setRenaming(false));
              if (e.key === "Escape") setRenaming(false);
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
      <Menu
        label={t("workspaceActions", name)}
        trigger={<IconMore />}
        triggerClass={c.iconBtn}
        triggerRef={menuBtn}
        tabIndex={-1}
        items={[
          {
            label: t("openInNewWindow"),
            onSelect: () => void attempt(() => send("workspace.open", { workspaceId: meta.id })),
          },
          {
            label: unsorted ? t("nameWorkspace") : t("rename"),
            hint: <Kbd>F2</Kbd>,
            onSelect: () => setRenaming(true),
          },
          {
            label: t("delete"),
            danger: true,
            hint: <Kbd>Del</Kbd>,
            disabled: p.disabled,
            onSelect: () => void deleteWorkspace(meta.id, name),
          },
        ]}
        extra={(close) => (
          <ColorSwatches
            inMenu
            value={meta.color}
            onChange={(color) => {
              close();
              void update({ color });
            }}
          />
        )}
      />
    </div>
  );
}
