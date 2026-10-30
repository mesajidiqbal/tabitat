import { describe, expect, it } from "vitest";
import en from "../../public/_locales/en/messages.json";
import { formatMessage, plural, t } from "./index";

describe("i18n", () => {
  it("falls back to the bundled en messages outside the extension", () => {
    expect(t("appName")).toBe("Tabitat");
    expect(t("switchingTo", "Research")).toBe("Switching to Research…");
    expect(t("fromTo", ["A", "B"])).toBe("A → B");
  });

  it("pluralises with n as the first substitution", () => {
    expect(plural(1, "tabsOne", "tabsMany")).toBe("1 tab");
    expect(plural(12, "tabsOne", "tabsMany")).toBe("12 tabs");
  });

  it("follows chrome.i18n placeholder semantics", () => {
    const entry = {
      message: "$A$ and $b$ cost $$5 ($1)",
      placeholders: { a: { content: "$2" }, b: { content: "$1" } },
    };
    expect(formatMessage(entry, ["x", "y"])).toBe("y and x cost $5 (x)");
  });

  it("every placeholder in messages.json maps to a positional substitution", () => {
    for (const [key, raw] of Object.entries(en)) {
      const entry = raw as { message: string; placeholders?: Record<string, { content: string }> };
      for (const name of entry.message.match(/\$([A-Za-z0-9_]+)\$/g) ?? []) {
        const ph = entry.placeholders?.[name.slice(1, -1).toLowerCase()];
        expect(ph?.content, `${key}: ${name}`).toMatch(/^\$[1-9]$/);
      }
    }
  });
});
