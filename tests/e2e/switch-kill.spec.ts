/**
 * Integration gate (review Y): a real Chrome service worker is stopped ~50 ms into a 30-tab
 * workspace switch. After the worker is woken again, the durable op journal must finish the
 * switch with exactly the target's tabs (no duplicates) and the outgoing workspace intact.
 * Uses the raw CDP driver (no Playwright on page targets) and ServiceWorker.stopWorker.
 */
import { expect, test } from "@playwright/test";
import { freshDir, sleep } from "../spike/harness";
import { RawChrome } from "../spike/rawcdp";

const B_COUNT = 30;
const A_URLS = Array.from({ length: 5 }, (_, i) => `http://127.0.0.1:9/a${i}`);
const B_URLS = Array.from({ length: B_COUNT }, (_, i) => `http://127.0.0.1:9/b${i}`);

interface Env {
  ok: boolean;
  value?: unknown;
  code?: string;
  message?: string;
}

test("worker stopped mid-switch: resume yields exactly B's tabs, A intact", async () => {
  test.setTimeout(60_000);
  const rc = new RawChrome(freshDir());
  await rc.start();
  try {
    const page = await rc.openExtPage("popup.html");
    let seq = 0;
    /** Sends an RPC from the extension page; `wait: false` fires it without awaiting a reply. */
    const rpc = (type: string, payload: unknown, wait = true) => {
      const msg = JSON.stringify({ kind: "tabitat.rpc", requestId: `e2e-${++seq}`, type, payload });
      return rc.evalIn<Env | null>(
        page,
        wait
          ? `return await chrome.runtime.sendMessage(${msg});`
          : `chrome.runtime.sendMessage(${msg}).catch(() => {}); return null;`,
      );
    };
    const until = async (what: string, fn: () => Promise<boolean>, ms = 20_000) => {
      const end = Date.now() + ms;
      for (;;) {
        try {
          if (await fn()) return;
        } catch {
          // the worker may be asleep / restarting
        }
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(200);
      }
    };
    await until("worker ready", async () => (await rpc("system.ping", {}))?.ok === true);

    // Window with workspace A (5 tabs), created unfocused so the popup tab stays elsewhere.
    const wA = await rc.evalIn<number>(
      page,
      `return (await chrome.windows.create({ url: ${JSON.stringify(A_URLS)}, focused: false })).id;`,
    );
    await sleep(1000);
    const created = await rpc("workspace.create", { name: "A", color: "blue", fromWindowId: wA });
    expect(created?.ok).toBe(true);
    const aId = (created?.value as { id: string } | undefined)?.id ?? "";

    // Workspace B (30 saved tabs) written straight into storage.
    const now = Date.now();
    await rc.evalIn(
      page,
      `const idx = (await chrome.storage.local.get("ws:index"))["ws:index"] ?? [];
       await chrome.storage.local.set({
         "ws:meta:B": { id: "B", name: "B", color: "green", kind: "named", resources: [],
                        createdAt: ${now}, updatedAt: ${now}, rev: 1 },
         "ws:tabs:B": { tabs: ${JSON.stringify(
           B_URLS.map((url, i) => ({ id: `b${i}`, url, title: `B${i}`, index: i })),
         )}, updatedAt: ${now}, rev: 1 },
         "ws:index": [...idx, "B"],
       });
       return true;`,
    );

    let stop: () => Promise<void>;
    try {
      stop = await rc.prepareStopWorker();
    } catch (e) {
      console.log(`[switch-kill] skipped: CDP ServiceWorker.stopWorker unavailable: ${e}`);
      test.skip(true, `CDP stopWorker unavailable: ${(e as Error).message}`);
      return;
    }

    // Trigger the switch, then stop the worker mid-switch: as soon as the op journal exists (or
    // at the latest ~50 ms after the trigger).
    await rpc("workspace.switch", { windowId: wA, workspaceId: "B" }, false);
    const t0 = Date.now();
    while (Date.now() - t0 < 50) {
      const stage = await rc.evalIn<string | null>(
        page,
        `return (await chrome.storage.local.get("op:switch:${wA}"))["op:switch:${wA}"]?.stage ?? null;`,
      );
      if (stage !== null) break;
    }
    try {
      await stop();
    } catch (e) {
      console.log(`[switch-kill] skipped: stopWorker failed: ${e}`);
      test.skip(true, `stopWorker failed: ${(e as Error).message}`);
      return;
    }
    await sleep(300);
    // Evidence of where the kill landed (storage is readable without the worker).
    const pending = await rc.evalIn<{ stage?: string; created?: number } | null>(
      page,
      `const op = (await chrome.storage.local.get("op:switch:${wA}"))["op:switch:${wA}"];
       return op ? { stage: op.stage, created: Object.keys(op.createdTabIds).length } : null;`,
    );
    console.log(
      `[switch-kill] after stopWorker: ${pending ? `op at stage ${pending.stage}, ${pending.created} tabs recorded` : "switch had already completed"}`,
    );

    // Wake the worker (a message revives it; init resumes the journal) and wait for the op.
    await until("worker revived", async () => (await rpc("system.ping", {}))?.ok === true);
    await until("op finished", async () => {
      const st = await rpc("op.status", { windowId: wA });
      return st?.ok === true && st.value === null;
    });
    await sleep(1000);

    const state = await rc.evalIn<{
      urls: string[];
      pinned: number;
      keys: string[];
      aTabs: number;
    }>(
      page,
      `const tabs = await chrome.tabs.query({ windowId: ${wA} });
       const all = await chrome.storage.local.get(null);
       return {
         urls: tabs.filter((t) => !t.pinned).map((t) => t.url || t.pendingUrl || ""),
         pinned: tabs.filter((t) => t.pinned).length,
         keys: Object.keys(all),
         aTabs: (all["ws:tabs:${aId}"]?.tabs ?? []).length,
       };`,
    );
    const base = `chrome-extension://${rc.extId}/suspended.html`;
    const parsed = state.urls.map((u) => {
      if (!u.startsWith(`${base}#`)) return { u, s: null as string | null };
      const p = new URLSearchParams(u.slice(base.length + 1));
      return { u: p.get("u") ?? "", s: p.get("s") };
    });
    // exactly B's tabs, in order, each once
    expect(parsed.map((x) => x.u)).toEqual(B_URLS);
    const hints = parsed.map((x) => x.s).filter((s): s is string => s !== null);
    expect(new Set(hints).size).toBe(hints.length);
    for (const [i, x] of parsed.entries()) if (x.s !== null) expect(x.s).toBe(`b${i}`);
    // A intact, journal empty
    expect(state.aTabs).toBe(5);
    expect(state.keys.filter((k) => k.startsWith("op:switch:"))).toEqual([]);
  } finally {
    await rc.quit();
  }
});
