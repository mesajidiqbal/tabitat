/**
 * One todo. Its checkbox is the roving focus target (native checked state; Space toggles), and
 * carries the row keys: Enter toggles, F2 edits (double-click too), Delete removes, Alt+↑↓
 * moves. A visually hidden hint (`hintId`) lists them. Drag and drop reorders.
 */
import { useRef, useState } from "preact/hooks";
import type { Todo } from "@/core/model/types";
import { t } from "@/i18n";
import c from "../components/controls.module.css";
import { IconButton } from "../components/IconButton";
import type { RovingItem } from "../hooks/useRoving";
import { IconClose } from "../icons";
import s from "./widgets.module.css";

export const TODO_KEYS = "Enter F2 Delete Alt+ArrowUp Alt+ArrowDown";

export interface TodoRowProps {
  todo: Todo;
  item: RovingItem;
  /** Id of the keyboard hint the checkbox points at. */
  hintId?: string;
  /** Sets done to the value chosen at click time (C-B3). */
  onToggle: (done: boolean) => void;
  onEdit: (text: string) => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  drag: {
    over: boolean;
    onStart: () => void;
    onOver: () => void;
    onDrop: () => void;
    onEnd: () => void;
  };
}

export function TodoRow(p: TodoRowProps) {
  const { todo } = p;
  const [editing, setEditing] = useState(false);
  /** Set when the edit ended by key (Enter / Escape): the blur that follows is ignored. */
  const ended = useRef(false);
  const box = useRef<HTMLInputElement | null>(null);
  const startEdit = () => {
    ended.current = false;
    setEditing(true);
  };
  const stopEdit = () => {
    ended.current = true;
    setEditing(false);
    setTimeout(() => box.current?.focus());
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || e.isComposing) return;
    const k = e.key;
    if (e.altKey && (k === "ArrowUp" || k === "ArrowDown")) p.onMove(k === "ArrowUp" ? -1 : 1);
    else if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Space is the checkbox's own toggle (its change event).
    else if (k === "Enter") p.onToggle(!todo.done);
    else if (k === "F2") startEdit();
    else if (k === "Delete" || k === "Backspace") p.onDelete();
    else return p.item.onKeyDown(e);
    e.preventDefault();
  };
  const commit = (text: string) => {
    if (text.trim() !== todo.text) p.onEdit(text);
  };
  return (
    <li
      class={`${s.todo} ${p.drag.over ? s.dragOver : ""}`}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer?.setData("text/plain", todo.text);
        p.drag.onStart();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        p.drag.onOver();
      }}
      onDrop={(e) => {
        e.preventDefault();
        p.drag.onDrop();
      }}
      onDragEnd={p.drag.onEnd}
    >
      <input
        type="checkbox"
        class={s.todoBox}
        tabIndex={p.item.tabIndex}
        ref={(el) => {
          box.current = el;
          p.item.ref(el);
        }}
        onFocus={p.item.onFocus}
        onKeyDown={onKeyDown}
        checked={todo.done}
        aria-label={t("dashTodoToggle", todo.text)}
        aria-describedby={p.hintId}
        aria-keyshortcuts={TODO_KEYS}
        onChange={(e) => p.onToggle(e.currentTarget.checked)}
      />
      {editing ? (
        <input
          class={c.input}
          aria-label={t("dashTodoEdit")}
          // biome-ignore lint/a11y/noAutofocus: editing was just requested
          autoFocus
          defaultValue={todo.text}
          maxLength={1000}
          onBlur={(e) => {
            if (ended.current) return;
            commit(e.currentTarget.value);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            // IME: Enter / Escape that confirm or cancel a composition are not ours (C-B8).
            if (e.isComposing) return;
            if (e.key === "Enter") commit(e.currentTarget.value);
            else if (e.key !== "Escape") return;
            e.preventDefault();
            stopEdit();
          }}
        />
      ) : (
        // biome-ignore lint/a11y/noStaticElementInteractions: double-click edit; F2 is the key
        <span class={`${s.todoText} ${todo.done ? s.done : ""}`} onDblClick={startEdit}>
          {todo.text}
        </span>
      )}
      <span class={s.del}>
        <IconButton
          label={t("dashTodoDelete", todo.text)}
          icon={<IconClose size={14} />}
          tabIndex={-1}
          danger
          onClick={p.onDelete}
        />
      </span>
    </li>
  );
}
