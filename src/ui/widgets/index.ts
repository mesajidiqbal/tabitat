/**
 * Every widget card behind one module, so dashboard and side panel lazy-load one shared chunk:
 * per-card chunks make Rollup split the modules they share with the popup into many small
 * chunks, which costs more gzip than the cards save (docs/PHASE4.md §5 budgets).
 */
export { ErrorBanner } from "../components/ErrorBanner";
export { ProgressRow } from "../components/ProgressRow";
export { Notes } from "./Notes";
export { Pomodoro } from "./Pomodoro";
export { QuickLinksGrid } from "./QuickLinksGrid";
export { SearchWidget } from "./SearchWidget";
export { Todos } from "./Todos";
export { WorkspacesWidget } from "./WorkspacesWidget";
