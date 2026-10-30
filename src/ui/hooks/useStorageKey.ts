/**
 * UI read model (ADR-003): reads one storage.local key once and re-renders on onChanged.
 * Surfaces never write storage directly; mutations go through `send()` (messaging/client).
 */
import { useEffect, useState } from "preact/hooks";

export interface StorageKeyState<T> {
  value: T | undefined;
  loaded: boolean;
  error: string | null;
}

export function useStorageKey<T>(
  key: string | null,
  parse?: (raw: unknown) => T,
): StorageKeyState<T> {
  const [state, setState] = useState<StorageKeyState<T>>({
    value: undefined,
    loaded: false,
    error: null,
  });

  useEffect(() => {
    if (key === null) {
      setState({ value: undefined, loaded: true, error: null });
      return;
    }
    let alive = true;
    const apply = (raw: unknown) => {
      if (!alive) return;
      if (raw === undefined) {
        setState({ value: undefined, loaded: true, error: null });
        return;
      }
      try {
        setState({ value: parse ? parse(raw) : (raw as T), loaded: true, error: null });
      } catch (e) {
        setState({
          value: undefined,
          loaded: true,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };
    void chrome.storage.local.get(key).then((res) => apply(res[key]));
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !(key in changes)) return;
      apply(changes[key]?.newValue);
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(listener);
    };
    // `parse` is expected to be a stable module-level function (not a dependency).
  }, [key]);

  return state;
}
