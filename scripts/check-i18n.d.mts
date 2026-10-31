// Types for scripts/check-i18n.mjs (imported by its unit test).
export interface Family {
  prefix: string;
  why: string;
}
export interface CheckOptions {
  localesDir?: string;
  defaultLocale?: string;
  sources?: string[];
  families?: Family[];
}
export interface Missing {
  key: string;
  at: string;
  via: string;
}
export interface I18nResult {
  ok: boolean;
  root: string;
  keys: number;
  locales: string[];
  files: number;
  families: Array<Family & { keys: number; builtAt: string[] }>;
  problems: {
    unused: string[];
    missing: Missing[];
    placeholders: string[];
    families: string[];
    locales: string[];
  };
}
export interface CallRef {
  key: string;
  file: string;
  line: number;
  callee: string;
  subs: number | "some" | "plural";
}
export interface ScanResult {
  calls: CallRef[];
  dynamic: Array<{ prefix: string; file: string; line: number }>;
  literals: Set<string>;
  msgRefs: Array<{ key: string; file: string; line: number }>;
}
export const DYNAMIC_FAMILIES: Family[];
export const DEFAULT_OPTIONS: Required<CheckOptions>;
export function tokenize(src: string): Array<{ type: string; value?: string; start?: number }>;
export function scanSource(src: string, file: string): ScanResult;
export function messageUsage(entry: unknown): {
  named: string[];
  maxIndex: number;
  undeclared: string[];
  unusedPlaceholders: string[];
};
export function checkI18n(root: string, options?: CheckOptions): I18nResult;
export function formatReport(result: I18nResult): string;
