/** Destination choice for the bookmarks import: quick links / one workspace / one per folder. */
import { useId } from "preact/hooks";
import type { Color } from "@/core/model/types";
import { t } from "@/i18n";
import { ColorSwatches } from "../components/ColorSwatches";
import type { DestinationKind } from "./bookmarks-tree";
import s from "./options.module.css";

export interface ImportDestinationProps {
  dest: DestinationKind;
  onDest: (d: DestinationKind) => void;
  name: string;
  onName: (n: string) => void;
  color: Color;
  onColor: (c: Color) => void;
}

const OPTIONS: ReadonlyArray<
  readonly [DestinationKind, "optBmDestQuick" | "optBmDestWorkspace" | "optBmDestPerFolder"]
> = [
  ["quicklinks", "optBmDestQuick"],
  ["workspace", "optBmDestWorkspace"],
  ["workspacePerFolder", "optBmDestPerFolder"],
];

export function ImportDestination(p: ImportDestinationProps) {
  const group = useId();
  const nameId = useId();
  return (
    <>
      <fieldset class={s.radios}>
        <legend>{t("optBmDest")}</legend>
        {OPTIONS.map(([kind, label]) => (
          <label key={kind} class={s.toggle}>
            <input
              type="radio"
              name={group}
              checked={p.dest === kind}
              onChange={() => p.onDest(kind)}
            />
            <span>
              {t(label)}
              {kind === "workspacePerFolder" && (
                <span class={s.hint}> {t("optBmDestPerFolderHint")}</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      {p.dest === "workspace" && (
        <div class={s.field}>
          <label class={s.label} for={nameId}>
            {t("optBmWsName")}
          </label>
          <input
            id={nameId}
            class={s.control}
            type="text"
            maxLength={200}
            value={p.name}
            aria-invalid={p.name.trim() === "" ? "true" : undefined}
            aria-describedby={p.name.trim() === "" ? `${nameId}-e` : undefined}
            onInput={(e) => p.onName((e.currentTarget as HTMLInputElement).value)}
          />
          {p.name.trim() === "" && (
            <p class={s.err} id={`${nameId}-e`}>
              {t("optBmNameRequired")}
            </p>
          )}
        </div>
      )}
      {p.dest !== "quicklinks" && <ColorSwatches value={p.color} onChange={p.onColor} />}
    </>
  );
}
