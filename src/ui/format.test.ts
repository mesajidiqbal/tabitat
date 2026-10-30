import { describe, expect, it } from "vitest";
import { purgeLabel, unsortedDetail } from "./format";

describe("purgeLabel", () => {
  const DAY = 86_400_000;
  const RET = 30 * DAY;
  it("counts whole days left, rounded up", () => {
    expect(purgeLabel(0, RET, 0)).toBe("Purged in 30 days");
    expect(purgeLabel(0, RET, 29 * DAY + 1)).toBe("Purged in 1 day");
    expect(purgeLabel(0, RET, 28.5 * DAY)).toBe("Purged in 2 days");
  });
  it("overdue items read as purged within a day", () => {
    expect(purgeLabel(0, RET, RET)).toBe("Purged within a day");
    expect(purgeLabel(0, RET, RET + DAY)).toBe("Purged within a day");
  });
});

const tab = (title: string, url = "https://x.example/") => ({ title, url });

describe("unsortedDetail", () => {
  it("names the first two titles and counts the rest", () => {
    const tabs = [
      tab("GitHub"),
      tab("Gmail"),
      ...Array.from({ length: 9 }, (_, i) => tab(`T${i}`)),
    ];
    expect(unsortedDetail(tabs, "11 tabs")).toBe("GitHub, Gmail +9");
  });

  it("omits the suffix when nothing is left over", () => {
    expect(unsortedDetail([tab("GitHub"), tab("Gmail")], "2 tabs")).toBe("GitHub, Gmail");
    expect(unsortedDetail([tab("GitHub")], "1 tab")).toBe("GitHub");
  });

  it("falls back to the url for untitled tabs", () => {
    expect(unsortedDetail([tab("", "https://a.example/")], "1 tab")).toBe("https://a.example/");
  });

  it("falls back to the tab count when there are no tabs", () => {
    expect(unsortedDetail([], "0 tabs")).toBe("0 tabs");
    expect(unsortedDetail(undefined, "0 tabs")).toBe("0 tabs");
  });
});
