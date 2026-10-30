# ADR-003: All canonical writes go through serialized service-worker commands

Status: accepted (2026-10-30). Both reviewers rejected direct UI writes.

Context: `chrome.storage.local` has no compare-and-swap; concurrent
read-modify-write from popup, side panel, dashboard and the worker would
lose updates. v0 proposed version counters, which do not prevent this.

Decision: UI surfaces are read-only consumers of storage (+ onChanged).
Every mutation is a typed RPC command handled in the service worker by a
CommandRouter that serializes handlers per lane (`window:<id>` for tab
operations, `key:<storageKey>` for records). Records carry `rev`;
commands may pass `expectedRev` and get a `conflict` envelope when stale.
Handlers ack after persistence. Multi-key operations write an op record
first and delete it on commit; the op record is the source of truth while
present.

Consequences: one writer; a UI round trip (~ms) per mutation; optimistic
local signals keep the UI instant. SW must be awake to write (it wakes on
`sendMessage`).
