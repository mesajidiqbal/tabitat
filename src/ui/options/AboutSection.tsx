import { Keys } from "@/core/model/types";
import { t } from "@/i18n";
import { useStorageKey } from "../hooks/useStorageKey";
import { REPO_URL } from "./about";
import { Group, Section } from "./fields";
import s from "./options.module.css";

const flavorOf = (raw: unknown): "default" | "newtab" =>
  (raw as { flavor?: unknown } | undefined)?.flavor === "newtab" ? "newtab" : "default";

const version = (): string => {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "";
  }
};

export function AboutSection() {
  const flavor = flavorOf(useStorageKey(Keys.meta).value);
  return (
    <Section id="about" title={t("optAbout")}>
      <Group>
        <dl class={s.dl}>
          <dt>{t("optAboutVersion")}</dt>
          <dd>{version()}</dd>
          <dt>{t("optAboutFlavor")}</dt>
          <dd>{flavor === "newtab" ? t("optFlavorNewtab") : t("optFlavorDefault")}</dd>
          <dt>{t("optAboutLicense")}</dt>
          <dd>MIT</dd>
          <dt>{t("optAboutSource")}</dt>
          <dd>
            <a class={s.link} href={REPO_URL} target="_blank" rel="noopener noreferrer">
              {REPO_URL}
            </a>
          </dd>
        </dl>
        <p>{t("optAboutPrivacy")}</p>
      </Group>
    </Section>
  );
}
