/**
 * One quick-link tile: favicon (local `_favicon` endpoint) + title, opens in this tab (middle /
 * Ctrl-click: new tab, browser default). Menu: edit, move left / right, remove. Draggable.
 */
import { useState } from "preact/hooks";
import type { QuickLink } from "@/core/model/types";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import { Menu } from "../components/Menu";
import { faviconSrc } from "../format";
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

export function QuickLinkTile(p: {
  link: QuickLink;
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
  const icon = failed ? "" : faviconSrc(link.url).replace("size=16", "size=32");
  const title = link.title || link.url;
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
