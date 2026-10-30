# ADR-001: Tech stack — WXT + Preact/signals + plain CSS + valibot + Biome

Status: accepted (2026-10-30). Reviewed by Codex and Gemini; both kept.

Context: fast, lightweight MV3 extension with five UI surfaces sharing
components; must be easy for contributors.

Decision: TypeScript 5 strict; WXT 0.21 (Vite) as the extension framework;
Preact 10 + @preact/signals; plain CSS with custom properties and CSS
modules; valibot for schemas (persisted records, RPC payloads, imports);
fuzzysort for search; idb for blobs; Biome + tsc; Vitest + wxt/testing;
Playwright for E2E; npm.

Alternatives rejected: CRXJS (less maintained), Solid/Svelte 5 (smaller
contributor pool, no real size win at our scale), Tailwind (build and
contributor overhead for little gain), zod (larger), Dexie (unneeded).

Consequences: ~15 KB gz third-party runtime; any new runtime dependency
needs an ADR.
