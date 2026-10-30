/**
 * Which browser-internal schemes the running browser can open directly (spike S13: creating
 * another browser's internal scheme yields an empty tab). Detected from User-Agent Client Hints.
 */
interface BrandInfo {
  brand: string;
}
interface NavigatorLike {
  userAgentData?: { brands?: BrandInfo[] };
}

export function detectDirectSchemes(nav: unknown = globalThis.navigator): string[] {
  const brands = (nav as NavigatorLike | undefined)?.userAgentData?.brands ?? [];
  const names = brands.map((b) => String(b.brand).toLowerCase());
  const out = ["chrome:", "about:"];
  if (names.some((n) => n.includes("edge"))) out.push("edge:");
  if (names.some((n) => n.includes("brave"))) out.push("brave:");
  return out;
}
