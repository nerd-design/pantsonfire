import { collectPageImages } from "./page-collector.mjs";
import { scanImages } from "./matcher.mjs";

const activeScans = new Map();
let scanning = false;

// Only one scan runs at a time. No partial verdicts or progress UI.
chrome.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.id)) return;
  if (scanning) return;
  scanning = true;
  await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
  const scanId = crypto.randomUUID();
  activeScans.set(tab.id, scanId);
  const storageKey = `scan:${tab.id}`;
  await chrome.storage.session.remove(storageKey);

  let outcome;
  try {
    if (!/^https?:\/\//i.test(tab.url || "")) {
      throw new Error("restricted-page");
    }
    const injection = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageImages,
    });
    const collection = injection[0]?.result;
    if (!collection || !Array.isArray(collection.images)) {
      throw new Error("collection-failed");
    }

    outcome = collection.images.length
      ? await scanImages(tab, collection)
      : { kind: "no-images" };
  } catch {
    outcome = { kind: "collection-unavailable" };
  }

  scanning = false;
  if (activeScans.get(tab.id) !== scanId) return;
  try {
    const current = await chrome.tabs.get(tab.id);
    // Do not present a stale outcome for a different page.
    if (current.url !== tab.url) return;
    await chrome.storage.session.set({
      [storageKey]: { ...outcome, scanId },
    });
    await chrome.action.setBadgeText({ tabId: tab.id, text: outcome.kind === "foreign" ? "👖🔥" : outcome.kind === "domestic" ? "👖" : "?" });
    const [selected] = await chrome.tabs.query({
      active: true,
      windowId: current.windowId,
    });
    if (selected?.id !== tab.id) return;
    await chrome.action.setPopup({
      tabId: tab.id,
      popup: `popup.html?tab=${tab.id}&scan=${encodeURIComponent(scanId)}`,
    });
    try {
      await chrome.action.openPopup({ windowId: current.windowId });
    } finally {
      // Every subsequent activation must start a fresh automatic collection.
      await chrome.action.setPopup({ tabId: tab.id, popup: "" });
    }
  } catch {
    // The tab/window may have closed or lost focus during collection.
    // No false verdict or unexpected new tab/window is shown.
  } finally {
    if (activeScans.get(tab.id) === scanId) activeScans.delete(tab.id);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeScans.delete(tabId);
  chrome.storage.session.remove(`scan:${tabId}`);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) {
    activeScans.delete(tabId);
    chrome.storage.session.remove(`scan:${tabId}`);
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(() => {
  // Remove the previous version's saved manual image URLs/search terms.
  chrome.storage.local.remove("lastSearch");
});
