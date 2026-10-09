import { collectPageImages } from "./page-collector.mjs";

export const marketplaces = ["1688.com", "made-in-china.com", "alibaba.com", "aliexpress.com", "aliexpress.us", "chinagoods.com", "yiwugo.com", "dhgate.com"];
export function marketplace(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && marketplaces.find(d => u.hostname === d || u.hostname.endsWith(`.${d}`));
  } catch { return false; }
}
export function publicImage(url) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password &&
      !/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(u.hostname) &&
      u.hostname.includes(".") && !/\.(local|internal)$/i.test(u.hostname);
  } catch { return false; }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// This function runs in the search tab, not in the extension's worker.
export function readSearchPage() {
  const text = document.body?.innerText || "";
  if (/unusual traffic|verify you are human|before you continue to google|not a robot|our systems have detected/i.test(text) ||
      document.querySelector('iframe[src*="recaptcha"]')) return { blocked: true };
  const root = document.querySelector("#search") || document.querySelector("#rso");
  const anchors = root ? [...root.querySelectorAll("a[href]")] : [];
  const links = anchors.filter(a => {
    try {
      const u = new URL(a.href);
      return (u.hostname === "www.google.com" && u.pathname === "/goto") ||
        (!/(^|\.)google\.com$/.test(u.hostname) && a.querySelector("img"));
    } catch { return false; }
  })
    .map(a => ({ url: a.href, label: a.innerText }));
  return {
    ready: !!root && /visual matches|exact matches|no matches for your search/i.test(text),
    empty: /no matches for your search/i.test(text),
    links,
  };
}

async function openPage(tabId, url, check) {
  await chrome.tabs.update(tabId, { url });
  for (let i = 0; i < 40; i++) {
    await check();
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") {
      await sleep(1500);
      return;
    }
    await sleep(750);
  }
  throw Error("A search or marketplace page timed out.");
}

async function fingerprint(url) {
  if (!publicImage(url)) throw Error("A non-public image cannot be checked.");
  const res = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(12000) });
  if (!res.ok || !res.headers.get("content-type")?.startsWith("image/")) throw Error("Image unavailable");
  const blob = await res.blob();
  if (blob.size > 12 * 1024 * 1024) throw Error("Image exceeds the 12 MB verification limit");
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width < 64 || bitmap.height < 64) throw Error("Image too small to verify reliably");
    const canvas = new OffscreenCanvas(32, 32);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 32, 32);
    ctx.drawImage(bitmap, 0, 0, 32, 32);
    return { ratio: bitmap.width / bitmap.height, pixels: [...ctx.getImageData(0, 0, 32, 32).data] };
  } finally { bitmap.close(); }
}

// Conservative same-framing comparison. Not proof of byte-for-byte identity.
export function samePhoto(a, b) {
  if (Math.abs(Math.log(a.ratio / b.ratio)) > 0.08) return false;
  let error = 0, sum = 0, squared = 0;
  for (let i = 0; i < a.pixels.length; i++) {
    if (i % 4 === 3) continue;
    error += (a.pixels[i] - b.pixels[i]) ** 2;
    sum += a.pixels[i];
    squared += a.pixels[i] ** 2;
  }
  const n = a.pixels.length * 0.75;
  return squared / n - (sum / n) ** 2 > 300 && Math.sqrt(error / n) < 12;
}

export async function scanImages(sourceTab, collection) {
  const tab = await chrome.tabs.create({ url: "about:blank", active: false, windowId: sourceTab.windowId });
  const matches = [], failures = [];
  let checked = 0;
  const started = Date.now();
  const cache = new Map();
  async function check() {
    const source = await chrome.tabs.get(sourceTab.id);
    if (source.url !== sourceTab.url) throw Error("The original page changed. Scan stopped.");
    if (Date.now() - started > 15 * 60 * 1000) throw Error("The 15-minute scan limit was reached.");
  }
  async function image(url) {
    if (!cache.has(url)) cache.set(url, fingerprint(url).catch(() => null));
    return cache.get(url);
  }
  try {
    for (const item of collection.images) {
      await check();
      const original = await image(item.url);
      if (!original) { failures.push("An image was inaccessible, private, oversized, or too small."); continue; }
      await openPage(tab.id, `https://www.google.com/searchbyimage?image_url=${encodeURIComponent(item.url)}&hl=en`, check);
      let result;
      for (let attempt = 0; attempt < 12; attempt++) {
        [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readSearchPage });
        if (result?.result?.blocked) throw Error("Google requested consent or human verification. No challenge was bypassed.");
        if (result?.result?.ready && (result.result.links.length || result.result.empty)) break;
        await sleep(1000);
      }
      if (!result?.result?.ready || (!result.result.empty && !result.result.links.length)) throw Error("Google's result layout could not be read.");
      // Load additional results without changing the user's selected tab.
      for (let scroll = 0; scroll < 3; scroll++) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => window.scrollTo(0, document.body.scrollHeight) });
        await sleep(1000);
      }
      [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: readSearchPage });
      if (result.result.blocked) throw Error("Google requested human verification.");
      if (!result.result.ready || (!result.result.empty && !result.result.links.length)) throw Error("Search results did not finish loading.");
      const candidates = new Set();
      let unresolved = false;
      for (const link of result.result.links) {
        if (marketplace(link.url)) candidates.add(link.url);
        else if (/dhgate|aliexpress|alibaba|1688|made.in.china|chinagoods|yiwugo/i.test(link.label)) {
          try {
            const u = new URL(link.url);
            if (u.hostname !== "www.google.com" || u.pathname !== "/goto") { unresolved = true; continue; }
            const res = await fetch(u.href, { credentials: "omit", signal: AbortSignal.timeout(12000) });
            if (marketplace(res.url)) candidates.add(res.url);
            else unresolved = true;
          } catch { unresolved = true; }
        }
      }
      let verified = false;
      for (const url of candidates) {
        await openPage(tab.id, url, check);
        const [{ result: photos }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageImages });
        let readable = false;
        for (const photo of photos?.images || []) {
          await check();
          const candidate = await image(photo.url);
          if (!candidate) { unresolved = true; continue; }
          readable = true;
          if (samePhoto(original, candidate)) {
            matches.push({ source: item.url, listing: url, image: photo.url, marketplace: marketplace(url) });
            verified = true;
            break;
          }
        }
        if (!readable) unresolved = true;
        if (verified) break;
      }
      if (unresolved && !verified) failures.push("A marketplace candidate could not be fully verified.");
      checked++;
      await sleep(1500);
    }
  } catch (error) {
    failures.push(error.message || "The search tab became unavailable.");
  } finally {
    await chrome.tabs.remove(tab.id).catch(() => {});
  }
  if (collection.limitations?.length) failures.push(...collection.limitations);
  return {
    kind: matches.length ? "foreign" : failures.length ? "incomplete" : "domestic",
    matches, checked, total: collection.images.length,
    failures: [...new Set(failures)],
  };
}
