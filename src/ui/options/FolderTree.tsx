/** Folder checkbox tree for the bookmarks import (folders only, recursive link counts). */
import { t } from "@/i18n";
import { IconChevronDown, IconChevronRight } from "../icons";
import { type FolderNode, folderState } from "./bookmarks-tree";
import s from "./options.module.css";

export interface FolderTreeProps {
  nodes: readonly FolderNode[];
  selection: ReadonlySet<string>;
  expanded: ReadonlySet<string>;
  onSelect: (id: string, checked: boolean) => void;
  onExpand: (id: string) => void;
}

function Folder({ node, ...p }: FolderTreeProps & { node: FolderNode }) {
  const state = folderState(node, p.selection);
  const open = p.expanded.has(node.id);
  const title = node.title || t("optBmUntitled");
  const count = node.totalLinks;
  return (
    <li>
      <div class={s.treeRow}>
        {node.children.length > 0 ? (
          <button
            type="button"
            class={s.treeToggle}
            aria-expanded={open}
            aria-label={t("optBmToggle", title)}
            onClick={() => p.onExpand(node.id)}
          >
            {open ? <IconChevronDown /> : <IconChevronRight />}
          </button>
        ) : (
          <span class={s.treeSpacer} />
        )}
        <label class={s.treeLabel}>
          <input
            type="checkbox"
            checked={state === "all"}
            ref={(el) => {
              if (el) el.indeterminate = state === "some";
            }}
            aria-label={t("optBmFolderLabel", [title, count])}
            onChange={(e) => p.onSelect(node.id, (e.currentTarget as HTMLInputElement).checked)}
          />
          <span>{title}</span>
          <span class={s.count}>{count}</span>
        </label>
      </div>
      {open && node.children.length > 0 && (
        <ul>
          {node.children.map((c) => (
            <Folder key={c.id} node={c} {...p} />
          ))}
        </ul>
      )}
    </li>
  );
}

export function FolderTree(p: FolderTreeProps) {
  return (
    <ul class={s.tree} aria-label={t("optBmFolders")}>
      {p.nodes.map((n) => (
        <Folder key={n.id} node={n} {...p} />
      ))}
    </ul>
  );
}
