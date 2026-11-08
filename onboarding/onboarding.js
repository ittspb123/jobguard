const $ = (id) => document.getElementById(id);

async function init() {
  const { settings = {} } = await chrome.storage.local.get("settings");
  $("localOnly").checked = !!settings.localOnly;
  $("allSites").checked = await chrome.permissions.contains({ origins: ["<all_urls>"] });
}

$("localOnly").addEventListener("change", async (e) => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  await chrome.storage.local.set({ settings: { ...settings, localOnly: e.target.checked } });
  $("status").textContent = e.target.checked ? "Local-only mode is on." : "AI check is on for job pages.";
});

$("allSites").addEventListener("change", async (e) => {
  if (e.target.checked) {
    const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
    e.target.checked = granted;
    $("status").textContent = granted ? "JobGuard will check every page you open." : "JobGuard will stay on job sites only.";
  } else {
    await chrome.permissions.remove({ origins: ["<all_urls>"] });
    $("status").textContent = "JobGuard will stay on job sites only.";
  }
  await chrome.runtime.sendMessage({ type: "SYNC_ALL_SITES" });
});

$("done").addEventListener("click", () => window.close());

init();
