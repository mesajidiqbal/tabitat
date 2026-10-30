import { describe, expect, it } from "vitest";
import { BASE, rng } from "../testing/fixtures";
import {
  buildPlaceholderUrl,
  classifyUrl,
  hostOf,
  isBlankPageUrl,
  isDangerousUrl,
  isPlaceholderUrl,
  isRestorableUrl,
  isSameSite,
  normalizeForMatch,
  parsePlaceholderUrl,
  sanitizeFavIconUrl,
  schemeOf,
  unwrapUrl,
} from "./url";

describe("classifyUrl", () => {
  it.each([
    ["https://example.com/a", "placeholder"],
    ["http://example.com", "placeholder"],
    ["HTTPS://EXAMPLE.COM", "placeholder"],
    ["file:///Users/me/a.pdf", "placeholder"],
    ["ftp://ftp.example.com/x", "placeholder"],
    ["chrome://settings", "direct"],
    ["about:blank", "direct"],
    // other browsers' internal pages cannot be created on Chrome (spike S13)
    ["edge://flags", "skip"],
    ["brave://rewards", "skip"],
    ["vivaldi://about", "skip"],
    ["opera://settings", "skip"],
    ["chrome-extension://abc/page.html", "skip"],
    ["devtools://devtools/bundled/inspector.html", "skip"],
    ["javascript:alert(1)", "skip"],
    ["data:text/html,hi", "skip"],
    ["blob:https://example.com/uuid", "skip"],
    ["vbscript:msgbox", "skip"],
    ["", "skip"],
    ["   ", "skip"],
    ["not a url", "skip"],
    ["mailto:a@b.c", "skip"],
  ] as const)("%s -> %s", (url, mode) => {
    expect(classifyUrl(url)).toBe(mode);
  });

  it("directSchemes selects which internal schemes are created directly", () => {
    const edge = { directSchemes: ["chrome:", "edge:", "about:"] };
    expect(classifyUrl("edge://flags", edge)).toBe("direct");
    expect(classifyUrl("chrome://settings", edge)).toBe("direct");
    expect(classifyUrl("brave://x", edge)).toBe("skip");
    expect(classifyUrl("https://a.com", edge)).toBe("placeholder");
    // tolerant of case / missing colon; never makes unknown schemes direct
    expect(classifyUrl("edge://flags", { directSchemes: ["EDGE"] })).toBe("direct");
    expect(classifyUrl("chrome://settings", { directSchemes: ["edge:"] })).toBe("skip");
    expect(classifyUrl("javascript:x", { directSchemes: ["javascript:"] })).toBe("skip");
    expect(classifyUrl("about:blank", { directSchemes: [] })).toBe("skip");
  });

  it("isRestorableUrl accepts every known internal scheme, whatever the browser", () => {
    expect(isRestorableUrl("https://a.com")).toBe(true);
    expect(isRestorableUrl("about:blank")).toBe(true);
    for (const u of ["edge://flags", "brave://x", "vivaldi://x", "opera://x"]) {
      expect(isRestorableUrl(u)).toBe(true);
    }
    expect(isRestorableUrl("javascript:void(0)")).toBe(false);
    expect(isRestorableUrl("chrome-extension://a/b")).toBe(false);
  });

  it("schemeOf", () => {
    expect(schemeOf("HTTPS://a.com")).toBe("https:");
    expect(schemeOf("nope")).toBeNull();
  });
});

describe("isDangerousUrl", () => {
  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "data:text/html,x",
    "vbscript:x",
  ])("%s is dangerous", (u) => expect(isDangerousUrl(u)).toBe(true));
  it.each(["https://a.com", "about:blank", "chrome-extension://x/y", ""])("%s is not", (u) =>
    expect(isDangerousUrl(u)).toBe(false),
  );
});

describe("placeholder urls", () => {
  const params = { u: "https://example.com/a?b=1", t: "Title", w: "ws1", s: "tab1" };

  it("builds base#u=…&t=…&w=…&s=…", () => {
    const url = buildPlaceholderUrl(BASE, params);
    expect(url.startsWith(`${BASE}#u=`)).toBe(true);
    expect(url).toContain("&t=Title&w=ws1&s=tab1");
  });

  it("ignores a hash already present on the base", () => {
    expect(buildPlaceholderUrl(`${BASE}#old`, params)).toBe(buildPlaceholderUrl(BASE, params));
  });

  it("round-trips tricky values", () => {
    const tricky = [
      "https://example.com/a#frag&x=1",
      "https://example.com/?q=a&b=c#h",
      "https://例え.テスト/パス?クエリ=値",
      "https://example.com/with space/and+plus",
      "https://example.com/%20encoded%2F?x=%26",
      "file:///C:/My Documents/a b.pdf",
      "ftp://user@ftp.example.com/x;type=a",
    ];
    for (const u of tricky) {
      const p = { u, t: "A & B # C — ünïcödé 🚀 +plus", w: "w&=#", s: "s =+&" };
      expect(parsePlaceholderUrl(buildPlaceholderUrl(BASE, p), BASE)).toEqual(p);
    }
  });

  it("round-trips random strings (property)", () => {
    const rand = rng(42);
    const alphabet = "abc &#=?%+/:;é漢🚀\t\n'\"<>";
    const randStr = (n: number) =>
      Array.from(
        { length: n },
        () => [...alphabet][Math.floor(rand() * [...alphabet].length)],
      ).join("");
    for (let i = 0; i < 200; i++) {
      const p = {
        u: `https://example.com/${encodeURIComponent(randStr(8))}#${randStr(5)}`,
        t: randStr(12),
        w: randStr(4),
        s: randStr(4),
      };
      expect(parsePlaceholderUrl(buildPlaceholderUrl(BASE, p), BASE)).toEqual(p);
    }
  });

  it("rejects urls that are not ours", () => {
    expect(parsePlaceholderUrl("https://example.com/#u=https://a.com", BASE)).toBeNull();
    expect(parsePlaceholderUrl(BASE, BASE)).toBeNull();
    expect(parsePlaceholderUrl(`${BASE}#t=x`, BASE)).toBeNull();
    expect(parsePlaceholderUrl(`${BASE}?x=1#u=https%3A%2F%2Fa.com`, BASE)).toBeNull();
    expect(parsePlaceholderUrl(`${BASE}#u=https%3A%2F%2Fa.com`, "")).toBeNull();
  });

  it("rejects placeholders whose target is not placeholder-restorable", () => {
    for (const u of [
      "javascript:alert(1)",
      "data:text/html,x",
      "chrome://settings",
      "about:blank",
    ]) {
      const url = buildPlaceholderUrl(BASE, { u, t: "", w: "w", s: "s" });
      expect(parsePlaceholderUrl(url, BASE)).toBeNull();
      expect(unwrapUrl(url, BASE)).toBe(url);
    }
  });

  it("defaults missing t/w/s to empty strings", () => {
    expect(parsePlaceholderUrl(`${BASE}#u=https%3A%2F%2Fa.com%2F`, BASE)).toEqual({
      u: "https://a.com/",
      t: "",
      w: "",
      s: "",
    });
  });

  it("unwrapUrl / isPlaceholderUrl", () => {
    const url = buildPlaceholderUrl(BASE, params);
    expect(unwrapUrl(url, BASE)).toBe(params.u);
    expect(isPlaceholderUrl(url, BASE)).toBe(true);
    expect(unwrapUrl("https://x.com", BASE)).toBe("https://x.com");
    expect(isPlaceholderUrl("https://x.com", BASE)).toBe(false);
  });
});

describe("isBlankPageUrl", () => {
  it.each([
    "about:blank",
    "ABOUT:BLANK",
    "about:blank#x",
    "chrome://newtab/",
    "chrome://newtab",
    "chrome://new-tab-page/",
    "edge://newtab/",
    "brave://newtab/",
  ])("%s is blank", (u) => expect(isBlankPageUrl(u)).toBe(true));
  it.each(["about:srcdoc", "chrome://settings", "https://newtab.com", "chrome://newtab/x", ""])(
    "%s is not",
    (u) => expect(isBlankPageUrl(u)).toBe(false),
  );
});

describe("sanitizeFavIconUrl", () => {
  it.each([
    ["https://a.com/f.ico", "https://a.com/f.ico"],
    ["http://a.com/f.ico", "http://a.com/f.ico"],
    ["chrome-extension://id/_favicon/?pageUrl=x", "chrome-extension://id/_favicon/?pageUrl=x"],
    ["chrome://favicon/https://a.com", "chrome://favicon/https://a.com"],
    ["data:image/png;base64,AAAA", undefined],
    ["blob:https://a.com/x", undefined],
    ["javascript:x", undefined],
    ["garbage", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("%s -> %s", (input, out) => expect(sanitizeFavIconUrl(input)).toBe(out));
});

describe("hosts", () => {
  it("hostOf", () => {
    expect(hostOf("https://Sub.Example.com:8080/x")).toBe("sub.example.com");
    expect(hostOf("about:blank")).toBeNull();
    expect(hostOf("file:///a")).toBeNull();
    expect(hostOf("garbage")).toBeNull();
  });
  it("isSameSite ignores www and scheme", () => {
    expect(isSameSite("https://www.a.com/x", "http://a.com/y")).toBe(true);
    expect(isSameSite("https://a.com", "https://b.com")).toBe(false);
    expect(isSameSite("about:blank", "about:blank")).toBe(false);
  });
});

describe("normalizeForMatch", () => {
  it.each([
    ["https://a.com/", "https://a.com"],
    ["https://a.com", "https://a.com"],
    ["https://A.com/x/#frag", "https://a.com/x"],
    ["https://a.com/x//", "https://a.com/x"],
    ["https://a.com/x/?q=1#h", "https://a.com/x?q=1"],
    ["https://a.com/?q=1", "https://a.com/?q=1"],
    ["about:blank", "about:blank"],
    ["file:///tmp/dir/", "file:///tmp/dir"],
    ["not a url/#x", "not a url"],
  ])("%s -> %s", (input, out) => {
    expect(normalizeForMatch(input)).toBe(out);
  });
});
