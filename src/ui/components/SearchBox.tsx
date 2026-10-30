/** Search input as a combobox over the results listbox (aria-activedescendant). */
import type { Ref } from "preact";
import { t } from "@/i18n";
import { IconClose, IconSearch } from "../icons";
import { IconButton } from "./IconButton";
import { Kbd } from "./Kbd";
import s from "./SearchBox.module.css";

export interface SearchBoxProps {
  value: string;
  onInput: (v: string) => void;
  onKeyDown: (e: KeyboardEvent) => void;
  inputRef: Ref<HTMLInputElement>;
  listId: string;
  activeId?: string | undefined;
  autoFocus?: boolean;
}

export function SearchBox(p: SearchBoxProps) {
  const open = p.value.trim() !== "";
  return (
    <div class={s.box}>
      <span class={s.icon}>
        <IconSearch />
      </span>
      <input
        ref={p.inputRef}
        class={s.input}
        type="text"
        role="combobox"
        aria-label={t("searchLabel")}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? p.listId : undefined}
        aria-activedescendant={open ? p.activeId : undefined}
        aria-keyshortcuts="/"
        placeholder={t("searchPlaceholder")}
        spellcheck={false}
        autoComplete="off"
        // biome-ignore lint/a11y/noAutofocus: UI-SPEC: search is focused when the popup opens
        autoFocus={p.autoFocus}
        value={p.value}
        onInput={(e) => p.onInput(e.currentTarget.value)}
        onKeyDown={p.onKeyDown}
      />
      <span class={s.end}>
        {open ? (
          <IconButton
            label={t("clearSearch")}
            icon={<IconClose size={14} />}
            onClick={() => p.onInput("")}
            tabIndex={-1}
          />
        ) : (
          <Kbd>/</Kbd>
        )}
      </span>
    </div>
  );
}
