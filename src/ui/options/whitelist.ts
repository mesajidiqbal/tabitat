/**
 * Suspension whitelist editor logic (pure): one host per line, normalized with
 * `normalizeWhitelistEntry`, unique, invalid lines reported, capped at LIMITS.whitelistHosts.
 */
import { LIMITS } from "@/core/model/types";
import { normalizeWhitelistEntry } from "@/core/suspend/rules";

export interface InvalidLine {
  /** 1-based line number in the textarea. */
  line: number;
  text: string;
}

export interface ParsedWhitelist {
  /** Normalized, unique, valid hosts in first-seen order. */
  hosts: string[];
  invalid: InvalidLine[];
  /** More than LIMITS.whitelistHosts unique hosts: nothing may be saved. */
  overLimit: boolean;
}

const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** The (punycode) host for a normalized entry, or null when it is not a plausible hostname. */
export function validHost(entry: string): string | null {
  let host: string;
  try {
    host = new URL(`http://${entry}`).hostname;
  } catch {
    return null;
  }
  if (host === "" || host.length > 253) return null;
  return host.split(".").every((l) => LABEL.test(l)) ? host : null;
}

export function parseWhitelist(text: string): ParsedWhitelist {
  const hosts: string[] = [];
  const seen = new Set<string>();
  const invalid: InvalidLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const entry = normalizeWhitelistEntry(raw);
    if (entry === null) return;
    const host = validHost(entry);
    if (host === null) {
      invalid.push({ line: i + 1, text: raw.trim() });
      return;
    }
    if (!seen.has(host)) {
      seen.add(host);
      hosts.push(host);
    }
  });
  return { hosts, invalid, overLimit: hosts.length > LIMITS.whitelistHosts };
}

/** Textarea content for a stored list. */
export const whitelistText = (hosts: readonly string[]): string => hosts.join("\n");
