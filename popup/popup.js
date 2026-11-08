const $ = (id) => document.getElementById(id);
let tab = null;
let domain = "";

let pagePort = null;

// Tell the page the popup is open so it hides banner 

function connectToPage() {
  try {
    pagePort = chrome.tabs.connect(tab.id, { name: "jobguard-popup" });
    pagePort.onDisconnect.addListener(() => { void chrome.runtime.lastError; });
  } catch {}
}

const VIEW = {
  green: { icon: "✓", title: "No scam signs found", sub: "This page looks okay. Stay alert if anyone asks for money or bank info." },
  yellow: { icon: "!", title: "Caution: double-check this", sub: "Some warning signs. Verify the company before sharing personal info." },
  red: { icon: "✕", title: "Stop: likely scam", sub: "Several strong scam signs. Don't enter personal or bank details here." },
  trusted: { icon: "✓", title: "You trust this site", sub: "JobGuard won't warn you here." },
  none: { icon: "?", title: "Not checked yet", sub: "JobGuard checks job sites automatically. Use the button below for any other page." }
};

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try { domain = new URL(tab.url).hostname.toLowerCase(); } catch { domain = ""; }
  connectToPage();

  const { settings = {}, reports = [] } = await chrome.storage.local.get(["settings", "reports"]);
  $("localOnly").checked = !!settings.localOnly;
  $("allSites").checked = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  $("reportCount").textContent = reports.length ? `${reports.length} mistake report${reports.length === 1 ? "" : "s"} saved on this device.` : "";

  await showResult();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "session" && changes[`tab_${tab.id}`]) showResult();
  });
}

async function showResult() {
  const data = await chrome.storage.session.get(`tab_${tab.id}`);
  const r = data[`tab_${tab.id}`];
  const level = r?.level || "none";
  const v = VIEW[level];

  const box = $("verdict");
  box.className = `verdict ${level === "none" ? "neutral" : level === "trusted" ? "neutral" : level}`;
  $("v-icon").textContent = v.icon;
  $("v-title").textContent = v.title;

  let sub = v.sub;
  if (r && level !== "trusted") {
    const ai = { used: "AI check used.", unavailable: "AI check unavailable, local rules only.", "local-only": "Local-only mode.", off: "" }[r.aiStatus] || "";
    sub += ` Risk score ${r.score}/100. ${ai}`;
  }
  $("v-sub").textContent = sub;

  const list = $("reasons");
  list.innerHTML = "";
  (r?.reasons || []).slice(0, 5).forEach((reason) => {
    const li = document.createElement("li");
    const tag = document.createElement("span");
    tag.className = `tag ${reason.source}`;
    tag.textContent = reason.source === "ai" ? "AI" : "Rule";
    li.append(tag, document.createTextNode(" " + reason.text));
    list.appendChild(li);
  });

  const todo = $("todo");
  if (r?.officialSite && (level === "yellow" || level === "red")) {
    todo.hidden = false;
    todo.textContent = `What to do: look for this job on ${r.claimedCompany}'s official site (${r.officialSite}).`;
  } else todo.hidden = true;

  $("trust").hidden = !(r && (level === "yellow" || level === "red"));
  $("untrust").hidden = level !== "trusted";
}

// "Check this page" uses activeTab: access to this one tab.
$("check").addEventListener("click", async () => {
  $("status").textContent = "Checking…";
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content/content.js"] });
    setTimeout(connectToPage, 300);
    setTimeout(() => { if ($("status").textContent === "Checking…") $("status").textContent = ""; }, 4000);
  } catch {
    $("status").textContent = "JobGuard can't check this kind of page (for example, Chrome settings or the Web Store).";
  }
});

$("trust").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "TRUST", domain });
  await chrome.storage.session.set({ [`tab_${tab.id}`]: { level: "trusted", score: 0, reasons: [], domain } });
  $("status").textContent = `You now trust ${domain}.`;
});

$("untrust").addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "UNTRUST", domain });
  await chrome.storage.session.remove(`tab_${tab.id}`);
  $("status").textContent = `Removed ${domain} from trusted sites. Use "Check this page" to re-check.`;
  showResult();
});

$("localOnly").addEventListener("change", async (e) => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, localOnly: e.target.checked } });
  $("status").textContent = e.target.checked ? "Local-only mode on. Nothing leaves this device." : "AI check turned back on for job pages.";
});

$("allSites").addEventListener("change", async (e) => {
  if (e.target.checked) {
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    e.target.checked = granted;
    $("status").textContent = granted ? "JobGuard will now check every page you open." : "Okay, JobGuard will stay on job sites only.";
  } else {
    await chrome.permissions.remove({ origins: ["<all_urls>"] });
    $("status").textContent = "JobGuard is back to job sites only.";
  }
  await chrome.runtime.sendMessage({ type: "SYNC_ALL_SITES" });
});

init();
