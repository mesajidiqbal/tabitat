import { describe, expect, it } from "vitest";
import en from "../../public/_locales/en/messages.json";
import { describeError } from "./errors";

describe("describeError", () => {
  it("maps every envelope code to its localized sentence and keeps the raw message", () => {
    for (const code of ["conflict", "busy", "not_found", "invalid", "limit", "internal"] as const) {
      const d = describeError(code, `raw ${code}`);
      expect(d.text).toBe(en[`err_${code}`].message);
      expect(d.detail).toBe(`raw ${code}`);
    }
  });

  it("describes unknown codes as internal", () => {
    expect(describeError("weird", "x")).toEqual({ text: en.err_internal.message, detail: "x" });
    expect(describeError("toString", "x").text).toBe(en.err_internal.message);
  });
});
