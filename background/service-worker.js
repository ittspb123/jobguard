// JobGuard service worker: scoring, backend calls, badge, settings.
// It holds no state in memory that matters — Manifest V3 service workers sleep,
// so anything that must survive goes in chrome.storage.

import { analyze, mergeAI, redactPII } from "../rules/rules.js";
import { API_URL, API_TIMEOUT_MS, THRESHOLDS } from "../config.js";

const ALL_SITES_SCRIPT_ID = "jobguard-all-sites";
const DEFAULT_SETTINGS = { localOnly: false };
const cache = new Map(); // best-effort, cleared whenever the worker sleeps
const CACHE_TTL_MS = 10 * 60 * 1000;

// ---------- install / startup ----------

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const { settings } = await chrome.storage.local.get("settings");
  if (!settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, trusted: [], reports: [] });
  if (reason === "install") chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
  await syncAllSites();
});

chrome.runtime.onStartup.addListener(syncAllSites);
chrome.permissions.onAdded.addListener(syncAllSites);
chrome.permissions.onRemoved.addListener(syncAllSites);

// Register the content script on every site ONLY if the user opted in and
// Chrome granted the optional <all_urls> permission.
async function syncAllSites() {
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [ALL_SITES_SCRIPT_ID] });
  if (granted && !existing.length) {
    await chrome.scripting.registerContentScripts([
      { id: ALL_SITES_SCRIPT_ID, matches: ["<all_urls>"], js: ["content/content.js"], runAt: "document_idle" }
    ]);
  } else if (!granted && existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [ALL_SITES_SCRIPT_ID] });
  }
}

// ---------- messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handle(msg, sender)
    .then(sendResponse)
    .catch((err) => sendResponse({ error: String(err?.message || err) }));
  return true; // keep the channel open for the async response
});

async function handle(msg, sender) {
  switch (msg?.type) {
    case "ANALYZE":
      return analyzePage(msg.features, sender.tab?.id);
    case "TRUST": {
      const { trusted = [] } = await chrome.storage.local.get("trusted");
      if (!trusted.includes(msg.domain)) trusted.push(msg.domain);
      await chrome.storage.local.set({ trusted });
      if (sender.tab?.id) await setBadge(sender.tab.id, "trusted");
      return { ok: true };
    }
    case "UNTRUST": {
      const { trusted = [] } = await chrome.storage.local.get("trusted");
      await chrome.storage.local.set({ trusted: trusted.filter((d) => d !== msg.domain) });
      return { ok: true };
    }
    case "REPORT": {
      // Stored only on this device. Teams can export these from the popup.
      const { reports = [] } = await chrome.storage.local.get("reports");
      reports.push({ domain: msg.domain, level: msg.level, at: new Date().toISOString() });
      await chrome.storage.local.set({ reports: reports.slice(-100) });
      return { ok: true };
    }
    case "SYNC_ALL_SITES":
      await syncAllSites();
      return { ok: true };
    default:
      return { error: "unknown message" };
  }
}

// ---------- analysis ----------

async function analyzePage(features, tabId) {
  if (!features?.domain) return { error: "no features" };
  const { settings = DEFAULT_SETTINGS, trusted = [] } = await chrome.storage.local.get(["settings", "trusted"]);

  if (trusted.includes(features.domain)) {
    const result = { level: "trusted", score: 0, reasons: [], domain: features.domain };
    await saveForTab(tabId, result);
    return result;
  }

  const key = `${features.domain}${features.path}|${(features.text || "").length}|${(features.sensitiveFields || []).join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    await saveForTab(tabId, hit.result);
    return hit.result;
  }

  let result = analyze(features, THRESHOLDS);
  result.aiStatus = "off";

  // Only job-related pages ever go to the backend, and only if the user
  // hasn't chosen local-only mode.
  if (!settings.localOnly && API_URL && result.jobRelated) {
    const remote = await callBackend(features, result.claimedCompany);
    if (remote) {
      if (typeof remote.domainAgeDays === "number") {
        result = analyze({ ...features, domainAgeDays: remote.domainAgeDays }, THRESHOLDS);
      }
      result = mergeAI(result, remote.ai, THRESHOLDS);
      result.aiStatus = remote.ai ? "used" : "unavailable";
    } else {
      result.aiStatus = "unavailable"; // timed out or failed → local rules still protect
    }
  } else if (settings.localOnly) {
    result.aiStatus = "local-only";
  }

  result.domain = features.domain;
  cache.set(key, { at: Date.now(), result });
  await saveForTab(tabId, result);
  return result;
}

async function callBackend(features, claimedCompany) {
  // Defense in depth: content script never sends typed values, and we strip
  // emails/phones/long numbers again here before anything leaves the device.
  const payload = {
    domain: features.domain,
    claimedCompany: claimedCompany || "",
    text: redactPII(`${features.title || ""}\n${features.text || ""}`).slice(0, 6000)
  };
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(API_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ---------- badge + per-tab results ----------

async function saveForTab(tabId, result) {
  if (tabId == null) return;
  await chrome.storage.session.set({ [`tab_${tabId}`]: result });
  await setBadge(tabId, result.level);
}

async function setBadge(tabId, level) {
  const styles = {
    green: { text: "OK", color: "#1f7a3d" },
    yellow: { text: "!", color: "#b45309" },
    red: { text: "X", color: "#b91c1c" },
    trusted: { text: "OK", color: "#475569" }
  };
  const s = styles[level] || { text: "", color: "#475569" };
  try {
    await chrome.action.setBadgeText({ tabId, text: s.text });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: s.color });
    await chrome.action.setTitle({ tabId, title: `JobGuard: ${level}` });
  } catch {
    // tab may have closed
  }
}

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(`tab_${tabId}`));

// A full page load starts fresh; the content script reports again if it runs.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "loading" && info.url) {
    chrome.storage.session.remove(`tab_${tabId}`);
    chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
  }
});
