import { expect, test } from "@playwright/test";
import { freshDir, log, sleep, targetServer, useBrave } from "./harness";
import { RawChrome } from "./rawcdp";

test.describe.configure({ mode: "serial" });

const MK = (n: number, origin: string) => `
  const tabs = await Promise.all(Array.from({length:${n}},(_,i)=>chrome.tabs.create({active:false,
    url: chrome.runtime.getURL("suspended.html")+"#u="+encodeURIComponent("${origin}/p"+i)+"&t=T"+i+"&w=ws1&s=s"+i})));
  return tabs.map(t=>t.id);`;

test("S1r_S3r placeholders without Playwright page emulation", async () => {
  const rc = new RawChrome(freshDir());
  const target = await targetServer();
  await rc.start();
  const ids = await rc.evalWorker<number[]>(MK(20, target.origin));
  await sleep(4000);
  const pre = target.hits.filter((h) => h.startsWith("/p")).length;
  const stillPh = await rc.evalWorker<number>(
    `let n=0; for (const id of ${JSON.stringify(ids)}) { if ((await chrome.tabs.get(id)).url.includes("suspended.html")) n++; } return n;`,
  );
  const before = await rc.evalWorker<{ index: number }>(
    `return {index:(await chrome.tabs.get(${ids[7]})).index}`,
  );
  const vis0 = await rc.pageVisibility("%2Fp7&");
  await rc.evalWorker(`await chrome.tabs.update(${ids[7]}, {active:true}); return 1;`);
  await sleep(3000);
  const vis1 =
    (await rc.pageVisibility("/p7")) !== "no-target"
      ? await rc.pageVisibility("/p7")
      : `still-placeholder:${await rc.pageVisibility("%2Fp7&")}`;
  const hits = target.hits.filter((h) => h.startsWith("/p"));
  const after = await rc.evalWorker<{ url: string; index: number }>(
    `const t=await chrome.tabs.get(${ids[7]}); return {url:t.url,index:t.index}`,
  );
  const back = await rc.evalWorker<string>(
    `try { await chrome.tabs.goBack(${ids[7]}); } catch(e) { return "goBack error: "+e.message } await new Promise(r=>setTimeout(r,1500)); return (await chrome.tabs.get(${ids[7]})).url;`,
  );
  log(`S1raw-visibility: p7 before=${vis0} after=${vis1}`);
  log(
    `S1raw: serverHitsAfter20PlaceholdersCreated(inactive)=${pre} placeholdersStillPlaceholder=${stillPh}/20 | after activating p7: serverHits=${JSON.stringify(hits)} tab7.url=${after.url}`,
  );
  log(
    `S3raw: indexBefore=${before.index} indexAfterActivate=${after.index} urlAfterGoBack=${back} backReturnsToPlaceholder=${back.includes("suspended.html")}`,
  );
  await rc.quit();
  await target.close();
});

test("S4r restart keeps placeholders", async () => {
  const dir = freshDir();
  const rc = new RawChrome(dir);
  const target = await targetServer();
  await rc.start();
  await rc.evalWorker(MK(3, target.origin));
  await sleep(1500);
  await rc.quit();
  await sleep(1000);
  const rc2 = new RawChrome(dir);
  await rc2.start(["--restore-last-session"]);
  await sleep(5000);
  const urls = await rc2.evalWorker<string[]>(
    `return (await chrome.tabs.query({})).map(t=>t.url||t.pendingUrl||"")`,
  );
  const ph = urls.filter((u) => u.includes("suspended.html"));
  const ok = ph.filter((u) => u.includes("#u=") && u.includes("w=ws1"));
  log(
    `S4raw: tabsAfterRestart=${urls.length} placeholders=${ph.length}/3 hashIntact=${ok.length} sample=${ph[0] ?? "none"} targetHitsAfterRestart=${target.hits.filter((h) => h.startsWith("/p")).length}${useBrave ? "" : " (Chrome: extension re-loaded via CDP after restore began, so restore ordering differs from an installed extension)"}`,
  );
  expect(urls.length).toBeGreaterThan(0);
  await rc2.quit();
  await target.close();
});

test("S2r placeholder plan timing without Playwright page emulation", async () => {
  const rc = new RawChrome(freshDir());
  const target = await targetServer();
  await rc.start();
  const totals: number[] = [];
  const parts: { c: number; a: number; r: number }[] = [];
  for (let r = 0; r < 8; r++) {
    const res = await rc.evalWorker<{ c: number; a: number; r: number }>(`
      const t0=performance.now();
      const tabs = await Promise.all(Array.from({length:20},(_,i)=>chrome.tabs.create({active:false,
        url: chrome.runtime.getURL("suspended.html")+"#u="+encodeURIComponent("${target.origin}/p"+i)+"&t=T"+i+"&w=ws1&s=s"+i})));
      const t1=performance.now(); const ids=tabs.map(t=>t.id);
      await chrome.tabs.update(ids[0],{active:true}); const t2=performance.now();
      await chrome.tabs.remove(ids); const t3=performance.now();
      return {c:t1-t0,a:t2-t1,r:t3-t2};`);
    parts.push(res);
    totals.push(res.c + res.a + res.r);
  }
  const s = [...totals].sort((a, b) => a - b);
  const f = (n: number) => Math.round(n);
  log(
    `S2raw: rounds=8 total ms p50=${f(s[4] ?? 0)} p95=${f(s[7] ?? 0)} max=${f(s[7] ?? 0)} | create p50=${f(parts.map((p) => p.c).sort((a, b) => a - b)[4] ?? 0)} remove p50=${f(parts.map((p) => p.r).sort((a, b) => a - b)[4] ?? 0)} | serverHitsTotal=${target.hits.filter((h) => h.startsWith("/p")).length} | all=${JSON.stringify(totals.map(f))}`,
  );
  await rc.quit();
  await target.close();
});

test("S6r idle kill and revive without devtools attached", async () => {
  const rc = new RawChrome(freshDir());
  await rc.start();
  await rc.detachWorker();
  const t0 = Date.now();
  let killedAfter = -1;
  while (Date.now() - t0 < 50_000) {
    await sleep(2500);
    if ((await rc.workerTargets()) === 0) {
      killedAfter = Date.now() - t0;
      break;
    }
  }
  const msg = await rc.evalExtPage<string>(
    "popup.html",
    `try { return "resolved:"+JSON.stringify(await chrome.runtime.sendMessage({ping:1})); } catch(e) { return "error:"+e.message }`,
  );
  await sleep(1500);
  const revived = (await rc.workerTargets()) > 0;
  log(
    `S6idle: workerTargetGoneAfterMs=${killedAfter} (-1 = still alive after 50s) sendMessageFromPopup=${msg} workerPresentAfterMessage=${revived}`,
  );
  await rc.quit();
});

test("S6k SW killed mid-op: record and tab ids survive, worker revives", async () => {
  const rc = new RawChrome(freshDir());
  const target = await targetServer();
  await rc.start();
  const ids = await rc.evalWorker<number[]>(MK(3, target.origin));
  await rc.evalWorker(
    `await chrome.storage.local.set({"op:switch:1": {id:"op1",stage:"opening",createdTabIds:${JSON.stringify(ids)}}}); return 1;`,
  );
  let killed = "";
  try {
    await rc.killWorker();
    killed = "stopWorker sent";
  } catch (e) {
    killed = `kill failed: ${(e as Error).message}`;
  }
  await sleep(1500);
  const goneAfterKill = (await rc.workerTargets()) === 0;
  const msg = await rc.evalExtPage<string>(
    "popup.html",
    `try { await chrome.runtime.sendMessage({ping:1}); return "resolved" } catch(e) { return "error:"+e.message }`,
  );
  await sleep(1500);
  const revived = await rc.reattachWorker();
  let persisted = "n/a";
  let valid = "n/a";
  if (revived) {
    persisted = await rc.evalWorker<string>(
      `return JSON.stringify((await chrome.storage.local.get("op:switch:1"))["op:switch:1"])`,
    );
    valid = await rc.evalWorker<string>(
      `const r=[]; for (const id of ${JSON.stringify(ids)}) { try { await chrome.tabs.get(id); r.push(true) } catch { r.push(false) } } return JSON.stringify(r)`,
    );
  }
  log(
    `S6kill: ${killed} workerGoneAfterKill=${goneAfterKill} popupMessage=${msg} workerRevived=${revived} opRecordPersisted=${persisted} createdTabIdsStillValid=${valid}`,
  );
  await rc.quit();
  await target.close();
});

test("S6reload runtime.reload with op record", async () => {
  const rc = new RawChrome(freshDir());
  const target = await targetServer();
  await rc.start();
  const ids = await rc.evalWorker<number[]>(MK(3, target.origin));
  await rc.evalWorker(
    `await chrome.storage.local.set({"op:switch:1": {id:"op1",stage:"opening",createdTabIds:${JSON.stringify(ids)}}}); return 1;`,
  );
  await rc.evalWorker("setTimeout(() => chrome.runtime.reload(), 50); return 1;");
  await sleep(4000);
  let back = false;
  let persisted = "n/a";
  let valid = "n/a";
  for (let i = 0; i < 10 && !back; i++) {
    back = await rc.reattachWorker().catch(() => false);
    if (!back) await sleep(500);
  }
  if (back) {
    persisted = await rc.evalWorker<string>(
      `return JSON.stringify((await chrome.storage.local.get("op:switch:1"))["op:switch:1"])`,
    );
    valid = await rc.evalWorker<string>(
      `const r=[]; for (const id of ${JSON.stringify(ids)}) { try { await chrome.tabs.get(id); r.push(true) } catch { r.push(false) } } return JSON.stringify(r)`,
    );
  }
  log(
    `S6reload: extensionBackAfterReload=${back} opRecordPersisted=${persisted} previousPlaceholderTabIdsValid=${valid}`,
  );
  await rc.quit();
  await target.close();
});
