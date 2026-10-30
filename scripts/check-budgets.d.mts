// Types for scripts/check-budgets.mjs (imported by its unit test).
export interface Budgets {
  surfaces: Record<string, number>;
  totalJs: number;
}
export interface Surface {
  name: string;
  entry: string;
}
export interface SurfaceRow {
  surface: string;
  missing: boolean;
  jsGz: number;
  cssGz: number;
  budget: number | null;
  ok: boolean;
  files: string[];
}
export interface BudgetResult {
  dir: string;
  surfaces: SurfaceRow[];
  total: { jsGz: number; files: number; budget: number; ok: boolean };
  ok: boolean;
}
export const DEFAULT_BUDGETS: Budgets;
export const SURFACES: Surface[];
export function htmlRefs(html: string): { js: string[]; css: string[] };
export function staticImports(code: string): string[];
export function surfaceFiles(root: string, entry: string): { js: string[]; css: string[] } | null;
export function gzipSizer(): (file: string) => number;
export function measureBudgets(
  root: string,
  budgets?: Budgets,
  surfaces?: readonly Surface[],
): BudgetResult;
export function formatTable(result: BudgetResult): string;
