/**
 * One quick-link tile: favicon (local `_favicon` endpoint, lazy) + title, opens in this tab
 * (middle / Ctrl-click: new tab, browser default). The tile link is the grid's roving focus
 * target (arrows / Home / End move between tiles); ContextMenu / Shift+F10 / right-click open
 * the tile menu (edit, move left / right, remove), which the visible "…" button opens as well.
 * Draggable.
 */
import { useRef, useState } from "preact/hooks";
import type { QuickLink } from "@/core/model/types";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import { Menu } from "../components/Menu";
import { useRowMenu } from "../components/RowActions";
import { faviconSrc } from "../format";
import type { RovingItem } from "../hooks/useRoving";
import { IconGlobe, IconMore } from "../icons";
import s from "./widgets.module.css";

const isWeb = (url: string) => /^https?:/i.test(url);

/** Non-web schemes (chrome:, file:, …) cannot be followed from an extension page: open via tabs. */
function openOther(e: MouseEvent, url: string): void {
  if (isWeb(url)) return;
  e.preventDefault();
  const newTab = e.button === 1 || e.ctrlKey || e.metaKey;
  void (newTab ? chrome.tabs.create({ url }) : chrome.tabs.update({ url }));
}

/** Grid keys: ←/→ (and ↑/↓) step through the tiles, Home / End jump. */
const STEP: Record<string, string> = {
  ArrowRight: "ArrowDown",
  ArrowLeft: "ArrowUp",
  ArrowDown: "ArrowDown",
  ArrowUp: "ArrowUp",
  Home: "Home",
  End: "End",
};

export function QuickLinkTile(p: {
  link: QuickLink;
  item: RovingItem;
  /** Moves roving focus by key (see STEP); returns false for other keys. */
  onNavKey: (key: string) => boolean;
  first: boolean;
  last: boolean;
  dragOver: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
  onDragStart: () => void;
  onDragOver: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const { link } = p;
  const [failed, setFailed] = useState(false);
  const tile = useRef<HTMLAnchorElement | null>(null);
  const menu = useRowMenu(true);
  const icon = failed ? "" : faviconSrc(link.url).replace("size=16", "size=32");
  const title = link.title || link.url;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === "ContextMenu" || (k === "F10" && e.shiftKey)) menu.open();
    else if (e.shiftKey || !(k in STEP) || !p.onNavKey(STEP[k] as string)) return;
    e.preventDefault();
  };
  return (
    <li
      class={`${s.tileWrap} ${p.dragOver ? s.dragOver : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/uri-list", link.url);
        p.onDragStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        p.onDragOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        p.onDrop();
      }}
      onDragEnd={p.onDragEnd}
    >
      <a
        class={s.tile}
        href={link.url}
        title={`${title}\n${link.url}`}
        draggable={false}
        tabIndex={p.item.tabIndex}
        ref={(el) => {
          tile.current = el;
          p.item.ref(el);
        }}
        aria-keyshortcuts="Shift+F10 ContextMenu"
        data-link-id={link.id}
        onFocus={p.item.onFocus}
        onKeyDown={onKeyDown}
        onContextMenu={menu.onContextMenu}
        onClick={(e) => openOther(e, link.url)}
        onAuxClick={(e) => openOther(e, link.url)}
      >
        <span class={s.tileIcon}>
          {icon ? (
            <img
              src={icon}
              width={20}
              height={20}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setFailed(true)}
            />
          ) : (
            <IconGlobe />
          )}
        </span>
        <span class={s.tileTitle}>{title}</span>
      </a>
      <span class={s.tileMenu}>
        <Menu
          label={t("dashLinkActions", title)}
          trigger={<IconMore />}
          triggerClass={c.iconBtn}
          triggerRef={menu.menuRef}
          tabIndex={-1}
          returnFocus={() => tile.current?.focus()}
          items={[
            { label: t("dashLinkEdit"), onSelect: p.onEdit },
            { label: t("dashLinkMoveLeft"), disabled: p.first, onSelect: () => p.onMove(-1) },
            { label: t("dashLinkMoveRight"), disabled: p.last, onSelect: () => p.onMove(1) },
            { label: t("dashLinkRemove"), danger: true, onSelect: p.onRemove },
          ]}
        />
      </span>
    </li>
  );
}
