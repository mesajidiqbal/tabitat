import { describe, expect, it } from "vitest";
import type { QuickLink } from "@/core/model/types";
import {
  addLink,
  defaultLinkTitle,
  moveLink,
  moveLinkTo,
  normalizeLinkUrl,
  QUICKLINK_CAP,
  reinsertLink,
  removeLink,
  sortLinks,
  updateLink,
} from "./quicklinks-logic";

const ql = (id: string, order: number): QuickLink => ({
  id,
  url: `https://${id}.test/`,
  title: id,
  order,
});
const ids = (x: QuickLink[]) => x.map((l) => l.id);

describe("quick link helpers", () => {
  it("normalizeLinkUrl adds https:// and rejects unsafe or empty input", () => {
    expect(normalizeLinkUrl("example.com")).toBe("https://example.com/");
    expect(normalizeLinkUrl(" http://a.test/x ")).toBe("http://a.test/x");
    expect(normalizeLinkUrl("localhost:3000")).toBe("https://localhost:3000/");
    expect(normalizeLinkUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLinkUrl("data:text/html,x")).toBeNull();
    expect(normalizeLinkUrl("")).toBeNull();
    expect(normalizeLinkUrl("two words")).toBeNull();
  });

  it("defaultLinkTitle is the host without www.", () => {
    expect(defaultLinkTitle("https://www.example.com/a")).toBe("example.com");
  });

  it("sortLinks orders and drops records the worker would reject", () => {
    const bad = { id: "bad id!", url: "https://x.test", title: "", order: 0 };
    const js = { id: "js", url: "javascript:alert(1)", title: "", order: 0 };
    expect(ids(sortLinks([ql("b", 2), bad, js, ql("a", 1)]))).toEqual(["a", "b"]);
  });

  it("add / update / remove renumber; add stops at the cap", () => {
    const two = addLink([ql("a", 7)], { id: "b", url: "https://b.test/", title: "B" });
    expect(two.map((x) => x.order)).toEqual([0, 1]);
    expect(updateLink(two, "b", { title: "Bee" })[1]?.title).toBe("Bee");
    expect(ids(removeLink(two, "a"))).toEqual(["b"]);
    const full = Array.from({ length: QUICKLINK_CAP }, (_, i) => ql(`l${i}`, i));
    expect(addLink(full, { id: "x", url: "https://x.test/", title: "" })).toHaveLength(
      QUICKLINK_CAP,
    );
  });

  it("reinsertLink puts a removed link back at its index (undo), once", () => {
    const list = [ql("a", 0), ql("c", 1)];
    const back = reinsertLink(list, ql("b", 1), 1);
    expect(ids(back)).toEqual(["a", "b", "c"]);
    expect(ids(reinsertLink(back, ql("b", 1), 0))).toEqual(["a", "b", "c"]);
  });

  it("moveLink / moveLinkTo reorder", () => {
    const list = [ql("a", 0), ql("b", 1), ql("c", 2)];
    expect(ids(moveLink(list, "a", 1))).toEqual(["b", "a", "c"]);
    expect(ids(moveLink(list, "a", -1))).toEqual(["a", "b", "c"]);
    expect(ids(moveLinkTo(list, "c", "a"))).toEqual(["c", "a", "b"]);
  });
});
