import { expect, test } from "@playwright/test";
import { launch, log, pct, sleep, targetServer, useBrave } from "./harness";

test.describe.configure({ mode: "serial" });

// Brave pass (Step C) only runs S1, S2, S6, S10.
const braveSet = new Set(["S1", "S2", "S6", "S10"]);
function spike(id: string, fn: () => Promise<void>) {
  test(id, async () => {
    test.skip(
      useBrave && !braveSet.has(id.slice(0, id.includes("_") ? id.indexOf("_") : undefined)),
    );
    await fn();
  });
}

async function createPlaceholders(
  worker: import("@playwright/test").Worker,
  extId: string,
  origin: string,
  n: number,
) {
  return worker.evaluate(
    async ({ extId, origin, n }) => {
      const t0 = performance.now();
      const tabs = await Promise.all(
        Array.from({ length: n }, (_, i) =>
          chrome.tabs.create({
            active: false,
            url: `chrome-extension://${extId}/suspended.html#u=${encodeURIComponent(`${origin}/p${i}`)}&t=T${i}&w=ws1&s=s${i}`,
          }),
        ),
      );
      return { ids: tabs.map((t) => t.id as number), ms: performance.now() - t0 };
    },
    { extId, origin, n },
  );
}

spike("S1", async () => {
  const { context, worker, extId } = await launch();
  const target = await targetServer();
  const extReqs: string[] = [];
  context.on("request", (r) => {
    if (r.url().startsWith(target.origin)) extReqs.push(r.url());
  });
  const { ids } = await createPlaceholders(worker, extId, target.origin, 20);
  await sleep(4000);
  const hitsBefore = target.hits.filter((h) => h.startsWith("/p")).length;
  const reqBefore = extReqs.length;
  const states = await worker.evaluate(async (ids) => {
    const ts = await Promise.all(ids.map((id) => chrome.tabs.get(id)));
    return ts.map((t) => ({ url: t.url, status: t.status, active: t.active }));
  }, ids);
  const stillPlaceholders = states.filter((s) => s.url?.includes("suspended.html")).length;
  await worker.evaluate((id) => chrome.tabs.update(id, { active: true }), ids[7] as number);
  await sleep(3000);
  const hitsAfter = target.hits.filter((h) => h.startsWith("/p"));
  const u7 = await worker.evaluate(async (id) => (await chrome.tabs.get(id)).url, ids[7] as number);
  log(
    `S1: targetHitsAfter20Placeholders=${hitsBefore} browserRequestsToTarget=${reqBefore} placeholdersStillPlaceholder=${stillPlaceholders}/20 | after activating p7: serverHits=${JSON.stringify(hitsAfter)} tab7.url=${u7}`,
  );
  await target.close();
  await context.close();
});

spike("S2", async () => {
  const { context, worker, extId } = await launch();
  const target = await targetServer();
  const rounds: { create: number; activate: number; remove: number; total: number }[] = [];
  for (let r = 0; r < 8; r++) {
    const res = await worker.evaluate(
      async ({ extId, origin }) => {
        const t0 = performance.now();
        const tabs = await Promise.all(
          Array.from({ length: 20 }, (_, i) =>
            chrome.tabs.create({
              active: false,
              url: `chrome-extension://${extId}/suspended.html#u=${encodeURIComponent(`${origin}/p${i}`)}&t=T${i}&w=ws1&s=s${i}`,
            }),
          ),
        );
        const t1 = performance.now();
        const ids = tabs.map((t) => t.id as number);
        await chrome.tabs.update(ids[0] as number, { active: true });
        const t2 = performance.now();
        await chrome.tabs.remove(ids);
        const t3 = performance.now();
        return { create: t1 - t0, activate: t2 - t1, remove: t3 - t2, total: t3 - t0 };
      },
      { extId, origin: target.origin },
    );
    rounds.push(res);
  }
  const totals = rounds.map((x) => x.total);
  const r0 = (n: number) => Math.round(n);
  log(
    `S2: rounds=${rounds.length} total ms p50=${r0(pct(totals, 50))} p95=${r0(pct(totals, 95))} max=${r0(Math.max(...totals))} | create p50=${r0(
      pct(
        rounds.map((x) => x.create),
        50,
      ),
    )} activate p50=${r0(
      pct(
        rounds.map((x) => x.activate),
        50,
      ),
    )} remove p50=${r0(
      pct(
        rounds.map((x) => x.remove),
        50,
      ),
    )} | all=${JSON.stringify(rounds.map((x) => r0(x.total)))}`,
  );
  await target.close();
  await context.close();
});

spike("S3", async () => {
  const { context, worker, extId } = await launch();
  const target = await targetServer();
  const { ids } = await createPlaceholders(worker, extId, target.origin, 3);
  const info = await worker.evaluate(async (id) => {
    const before = await chrome.tabs.get(id);
    await chrome.tabs.update(id, { active: true });
    return { index: before.index, windowId: before.windowId };
  }, ids[1] as number);
  await sleep(3000);
  const after = await worker.evaluate(async (id) => {
    const t = await chrome.tabs.get(id);
    return { url: t.url, index: t.index };
  }, ids[1] as number);
  const page = context.pages().find((p) => p.url().startsWith(target.origin));
  let backResult = "no playwright page for tab";
  if (page) {
    await page.goBack({ timeout: 5000 }).catch(() => null);
    await sleep(1500);
    backResult = page.url();
  }
  const t1 = await worker.evaluate(async (id) => (await chrome.tabs.get(id)).url, ids[1] as number);
  log(
    `S3: indexBefore=${info.index} indexAfter=${after.index} urlAfterActivate=${after.url} urlAfterBack(page)=${backResult} urlAfterBack(tabs.get)=${t1} backReturnsToPlaceholder=${String(t1?.includes("suspended.html"))}`,
  );
  await target.close();
  await context.close();
});

spike("S4", async () => {
  const first = await launch();
  const target = await targetServer();
  await createPlaceholders(first.worker, first.extId, target.origin, 3);
  await sleep(1500);
  const dir = first.userDataDir;
  await first.context.close();
  await sleep(1500);
  let line = "";
  try {
    const second = await launch(dir, ["--restore-last-session"]);
    await sleep(4000);
    const urls = await second.worker.evaluate(async () =>
      (await chrome.tabs.query({})).map((t) => t.url),
    );
    const ph = urls.filter((u) => u?.includes("suspended.html"));
    const withHash = ph.filter((u) => u?.includes("#u=") && u.includes("w=ws1"));
    line = `S4: restoredTabs=${urls.length} placeholdersRestored=${ph.length}/3 withHashIntact=${withHash.length} sample=${ph[0] ?? "none"}${ph.length === 0 ? " (NOT measured reliably: session restore may not be reproducible in automation)" : ""}`;
    await second.context.close();
  } catch (e) {
    line = `S4: not measured: ${(e as Error).message.split("\n")[0]}`;
  }
  log(line);
  await target.close();
});

spike("S5", async () => {
  const { context, worker } = await launch();
  const out = await worker.evaluate(async () => {
    chrome.alarms.onAlarm.addListener((a) => {
      const now = Date.now();
      chrome.storage.session.get(`alarm:${a.name}`).then((cur) => {
        const prev = cur[`alarm:${a.name}`] as { first: number; n: number } | undefined;
        chrome.storage.session.set({
          [`alarm:${a.name}`]: { first: prev?.first ?? now, n: (prev?.n ?? 0) + 1, last: now },
        });
      });
    });
    await chrome.alarms.clearAll();
    const created = Date.now();
    const errs: string[] = [];
    const mk = async (name: string, info: chrome.alarms.AlarmCreateInfo) => {
      try {
        await chrome.alarms.create(name, info);
      } catch (e) {
        errs.push(`${name}: ${(e as Error).message}`);
      }
    };
    await mk("p1s", { periodInMinutes: 1 / 60 });
    await mk("p30s", { periodInMinutes: 0.5 });
    await mk("p60s", { periodInMinutes: 1 });
    await mk("when1s", { when: created + 1000 });
    await mk("delay1s", { delayInMinutes: 1 / 60 });
    const all = await chrome.alarms.getAll();
    return {
      created,
      errs,
      all: all.map((a) => ({
        name: a.name,
        period: a.periodInMinutes,
        offsetMs: a.scheduledTime - created,
      })),
    };
  });
  const fired: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const deadline = Date.now() + 70_000;
  while (Date.now() < deadline) {
    const s = await worker.evaluate(() => chrome.storage.session.get(null));
    for (const [k, v] of Object.entries(s))
      if (k.startsWith("alarm:")) {
        const o = v as { first: number; n: number };
        fired[k.slice(6)] = o.first;
        counts[k.slice(6)] = o.n;
      }
    if (["p1s", "p30s", "p60s", "when1s", "delay1s"].every((n) => n in fired)) break;
    await sleep(1000);
  }
  const delays = Object.fromEntries(Object.entries(fired).map(([k, v]) => [k, v - out.created]));
  const msg = (await worker.evaluate(() => chrome.runtime.getManifest().version)) as string;
  log(
    `S5: (unpacked extension, version ${msg}) createErrors=${JSON.stringify(out.errs)} getAll=${JSON.stringify(out.all)} firstFireMsAfterCreate=${JSON.stringify(delays)} fireCountsAtEnd=${JSON.stringify(counts)} notFiredWithin70s=${JSON.stringify(["p1s", "p30s", "p60s", "when1s", "delay1s"].filter((n) => !(n in fired)))}`,
  );
  await context.close();
});

spike("S6", async () => {
  const { context, worker, extId } = await launch();
  const target = await targetServer();
  const { ids } = await createPlaceholders(worker, extId, target.origin, 3);
  await worker.evaluate(
    async (ids) =>
      chrome.storage.local.set({
        "op:switch:1": { id: "op1", windowId: 1, stage: "opening", createdTabIds: ids },
      }),
    ids,
  );
  const before = context.serviceWorkers().length;
  await worker.evaluate(() => chrome.runtime.reload()).catch(() => null);
  await sleep(2500);
  let reloaded = false;
  let w2 = context.serviceWorkers().find((w) => w !== worker && w.url().includes(extId));
  if (!w2) {
    w2 = await context.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => undefined);
  }
  reloaded = !!w2;
  let persisted = "n/a";
  let tabsValid = "n/a";
  if (w2) {
    persisted = JSON.stringify(
      await w2.evaluate(async () => (await chrome.storage.local.get("op:switch:1"))["op:switch:1"]),
    );
    tabsValid = JSON.stringify(
      await w2.evaluate(async (ids) => {
        const r: boolean[] = [];
        for (const id of ids) {
          try {
            await chrome.tabs.get(id);
            r.push(true);
          } catch {
            r.push(false);
          }
        }
        return r;
      }, ids),
    );
  }
  log(
    `S6a: runtime.reload newWorkerAppeared=${reloaded} workersBefore=${before} opRecordPersisted=${persisted} previousTabIdsStillValid=${tabsValid}${reloaded ? "" : " (no new worker after runtime.reload; popup.html then blocked. Under Playwright the extension is not re-enabled; see S6reload (raw) for the driver-free result)"}`,
  );
  await target.close();
  await context.close();
});

spike("S7", async () => {
  const { context, worker } = await launch();
  const out = await worker.evaluate(async () => {
    const a = await chrome.tabs.create({ url: "about:blank", active: false });
    const b = await chrome.tabs.create({ url: "about:blank", active: false });
    await chrome.tabs.remove(b.id as number);
    let rejected = false;
    let message = "";
    try {
      await chrome.tabs.remove([a.id as number, b.id as number]);
    } catch (e) {
      rejected = true;
      message = (e as Error).message;
    }
    let aStillExists = true;
    try {
      await chrome.tabs.get(a.id as number);
    } catch {
      aStillExists = false;
    }
    if (aStillExists) await chrome.tabs.remove(a.id as number);
    return { rejected, message, validIdStillExistsAfter: aStillExists };
  });
  log(`S7: ${JSON.stringify(out)}`);
  await context.close();
});

spike("S8", async () => {
  const { context, worker } = await launch();
  const target = await targetServer();
  const out = await worker.evaluate(async (origin) => {
    const t0 = performance.now();
    const tabs = await Promise.all(
      [1, 2, 3].map((i) => chrome.tabs.create({ url: `${origin}/g${i}`, active: false })),
    );
    const statuses = tabs.map((t) => t.status);
    const t1 = performance.now();
    let err = "";
    let groupId = -1;
    try {
      groupId = await chrome.tabs.group({
        tabIds: tabs.map((t) => t.id as number) as [number, ...number[]],
      });
      await chrome.tabGroups.update(groupId, { color: "green", title: "Spike" });
    } catch (e) {
      err = (e as Error).message;
    }
    const t2 = performance.now();
    const g = groupId >= 0 ? await chrome.tabGroups.get(groupId) : null;
    return {
      createMs: Math.round(t1 - t0),
      groupMs: Math.round(t2 - t1),
      statusesAtGroup: statuses,
      groupId,
      color: g?.color,
      title: g?.title,
      err,
    };
  }, target.origin);
  log(`S8: ${JSON.stringify(out)}`);
  await target.close();
  await context.close();
});

spike("S9", async () => {
  const { context, worker } = await launch();
  const cmds = await worker.evaluate(() => chrome.commands.getAll());
  log(
    `S9: commands=${JSON.stringify(cmds.map((c) => ({ n: c.name, s: c.shortcut })))} (key activation while SW asleep NOT measurable via automation: needs manual check)`,
  );
  await context.close();
});

spike("S10", async () => {
  const { context, worker, extId } = await launch();
  const out = await worker.evaluate(async () => {
    const r: Record<string, unknown> = {};
    try {
      await chrome.sidePanel.setOptions({ path: "sidepanel.html", enabled: true });
      r.setOptions = "ok";
      r.getOptions = await chrome.sidePanel.getOptions({});
    } catch (e) {
      r.setOptionsErr = (e as Error).message;
    }
    try {
      const w = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: w.id as number });
      r.openFromWorkerNoGesture = "resolved (opened)";
    } catch (e) {
      r.openFromWorkerNoGesture = `rejected: ${(e as Error).message}`;
    }
    return r;
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const fromPage = await popup.evaluate(async () => {
    try {
      const w = await chrome.windows.getCurrent();
      await chrome.sidePanel.open({ windowId: w.id as number });
      return "resolved (opened)";
    } catch (e) {
      return `rejected: ${(e as Error).message}`;
    }
  });
  log(
    `S10: ${JSON.stringify(out)} openFromExtensionPageNoGesture=${fromPage} (real gesture + command paths need manual check)`,
  );
  await context.close();
});

spike("S11", async () => {
  const { context, worker } = await launch();
  const target = await targetServer();
  const out = await worker.evaluate(async (origin) => {
    const t = await chrome.tabs.create({ url: `${origin}/loaded`, active: false });
    const id = t.id as number;
    let tab = t;
    for (let i = 0; i < 50 && tab.status !== "complete"; i++) {
      await new Promise((r) => setTimeout(r, 100));
      tab = await chrome.tabs.get(id);
    }
    const pre = { status: tab.status, title: tab.title };
    let discardErr = "";
    let d: chrome.tabs.Tab | undefined;
    try {
      d = await chrome.tabs.discard(id);
    } catch (e) {
      discardErr = (e as Error).message;
    }
    let sameIdStillExists = true;
    try {
      await chrome.tabs.get(id);
    } catch {
      sameIdStillExists = false;
    }
    const q = (await chrome.tabs.query({ url: `${origin}/*` }))[0];
    const x = (d ?? q) as chrome.tabs.Tab | undefined;
    return {
      pre,
      discardErr,
      idBefore: id,
      idReturnedByDiscard: d?.id,
      oldIdStillExists: sameIdStillExists,
      discarded: x?.discarded,
      title: x?.title,
      favIconUrl: x?.favIconUrl ?? null,
      lastAccessedPresent:
        typeof (x as { lastAccessed?: number } | undefined)?.lastAccessed === "number",
    };
  }, target.origin);
  log(
    `S11: ${JSON.stringify(out)} (note: local test page has no favicon, so favIconUrl null is expected)`,
  );
  await target.close();
  await context.close();
});

spike("S12", async () => {
  const { context, worker } = await launch();
  const out = await worker.evaluate(async () => {
    const exists = typeof chrome.search?.query === "function";
    if (!exists) return { exists };
    const before = (await chrome.tabs.query({})).map((t) => t.id);
    try {
      await chrome.search.query({ text: "tabitat", disposition: "NEW_TAB" });
    } catch (e) {
      return { exists, err: (e as Error).message };
    }
    await new Promise((r) => setTimeout(r, 2500));
    const after = await chrome.tabs.query({});
    const fresh = after.filter((t) => !before.includes(t.id));
    return {
      exists,
      newTabs: fresh.map((t) => ({
        url: (t.pendingUrl || t.url || "").slice(0, 120),
      })),
    };
  });
  log(`S12: ${JSON.stringify(out)}`);
  await context.close();
});

spike("S13", async () => {
  const { context, worker } = await launch();
  const out = await worker.evaluate(async () => {
    const r: Record<string, string> = {};
    for (const u of [
      "chrome://settings",
      "chrome://version",
      "edge://settings",
      "brave://settings",
    ]) {
      try {
        const t = await chrome.tabs.create({ url: u, active: false });
        await new Promise((res) => setTimeout(res, 1500));
        const f = await chrome.tabs.get(t.id as number);
        r[u] =
          `created id=${t.id} pendingUrl=${t.pendingUrl ?? t.url} afterLoad.url=${f.url} status=${f.status} title=${f.title}`;
      } catch (e) {
        r[u] = `error: ${(e as Error).message}`;
      }
    }
    return r;
  });
  log(`S13: ${JSON.stringify(out)}`);
  await context.close();
});

spike("S14", async () => {
  const { context, worker, extId } = await launch();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  const write = await worker.evaluate(async () => {
    const tabs = Array.from({ length: 50 }, (_, i) => ({
      id: `s${i}`,
      url: `https://www.example${i % 7}.com/some/long/path/${i}?q=tabitat&ref=spike#frag${i}`,
      title: `Example page number ${i} - a realistic tab title for measuring`,
      favIconUrl: `https://www.example${i % 7}.com/favicon.ico`,
      pinned: false,
      groupId: i % 5,
      lastAccessed: Date.now() - i * 1000,
    }));
    const rec = { rev: 1, tabs };
    const w: number[] = [];
    const g: number[] = [];
    for (let i = 0; i < 100; i++) {
      rec.rev = i;
      const a = performance.now();
      await chrome.storage.local.set({ "ws:tabs:bench": rec });
      w.push(performance.now() - a);
      const b = performance.now();
      await chrome.storage.local.get("ws:tabs:bench");
      g.push(performance.now() - b);
    }
    return { w, g, bytes: JSON.stringify(rec).length };
  });
  await popup.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { seen: number[] }).seen = seen;
    chrome.storage.onChanged.addListener((c) => {
      if (c["bench:evt"]) seen.push(Date.now());
    });
  });
  const sent: number[] = [];
  for (let i = 0; i < 30; i++) {
    sent.push(
      await worker.evaluate(async (i) => {
        const t = Date.now();
        await chrome.storage.local.set({ "bench:evt": { i, t } });
        return t;
      }, i),
    );
    await sleep(60);
  }
  await sleep(500);
  const seen = await popup.evaluate(() => (window as unknown as { seen: number[] }).seen);
  const deltas = seen.map((s, i) => s - (sent[i] as number));
  const f = (n: number) => Math.round(n * 100) / 100;
  log(
    `S14: recordBytes=${write.bytes} set p50=${f(pct(write.w, 50))}ms p95=${f(pct(write.w, 95))}ms | get p50=${f(pct(write.g, 50))}ms p95=${f(pct(write.g, 95))}ms | onChanged->popup events=${seen.length}/30 delta(Date.now, sender-before-set to receiver) p50=${f(pct(deltas, 50))}ms p95=${f(pct(deltas, 95))}ms`,
  );
  expect(seen.length).toBeGreaterThan(0);
  await context.close();
});
