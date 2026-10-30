import { describe, expect, it } from "vitest";
import { unsortedDetail } from "./format";

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
