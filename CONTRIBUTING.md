# Contributing

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:` ...).
- Formatting and linting use Biome: `npm run format`, `npm run lint`. Run `npm run check` before pushing.
- Core purity: code in `src/core` must not import `wxt/browser` or reference `chrome.` / `browser.`.
  `scripts/check-core-purity.mjs` (part of `npm run lint`) enforces this. Browser access goes through
  `src/platform`.
- Significant design decisions are recorded as ADRs in `docs/adr/`; add a new numbered file rather than
  rewriting history.
