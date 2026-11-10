const status = document.getElementById("status");
const overwriteBox = document.getElementById("overwrite");
const autoBox = document.getElementById("autodetect");
const neverNote = document.getElementById("neverNote");
const ALL_SITES = { origins: ["<all_urls>"] };

async function saveSetting(name, value) {
  const { settings = {} } = await chrome.storage.local.get("settings");
  settings[name] = value;
  await chrome.storage.local.set({ settings });
}

let tabHost = "";
(async () => {
  const [{ settings = {}, profile }, granted, [tab]] = await Promise.all([
    chrome.storage.local.get(["settings", "profile"]),
    chrome.permissions.contains(ALL_SITES),
    chrome.tabs.query({ active: true, currentWindow: true })
  ]);
  overwriteBox.checked = !!settings.overwrite;
  autoBox.checked = !!settings.autoDetect && granted;
  try { tabHost = new URL(tab.url).hostname; } catch {}
  neverNote.hidden = !(autoBox.checked && tabHost && (settings.neverHosts || []).includes(tabHost));
  if (!profile || !profile.firstName) status.textContent = "Start by filling in your profile.";
})();

overwriteBox.addEventListener("change", () => saveSetting("overwrite", overwriteBox.checked));

autoBox.addEventListener("change", async () => {
  const on = autoBox.checked;
  // Both calls start right away: the permission prompt must open while the click still counts as a
  // user gesture, and the popup may close while it's showing (the background script finishes setup).
  const saved = saveSetting("autoDetect", on);
  if (!on) {
    await saved;
    status.textContent = "Auto-detect is off.";
    return;
  }
  const granted = await chrome.permissions.request(ALL_SITES).catch(() => false);
  await saved;
  if (!granted) {
    autoBox.checked = false;
    await saveSetting("autoDetect", false);
    status.textContent = "Auto-detect needs access to the sites you visit to look for application questions.";
    return;
  }
  status.textContent = "On. Reload an application page to be asked whether to fill it.";
});

document.getElementById("allowHere").addEventListener("click", async () => {
  const { settings = {} } = await chrome.storage.local.get("settings");
  settings.neverHosts = (settings.neverHosts || []).filter((h) => h !== tabHost);
  await chrome.storage.local.set({ settings });
  neverNote.hidden = true;
  status.textContent = "Prompts are back on for this site.";
});

document.getElementById("edit").addEventListener("click", () => chrome.runtime.openOptionsPage());

document.getElementById("fill").addEventListener("click", async () => {
  status.textContent = "Filling…";
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const files = ["core.js", "fill.js"];
  try {
    let results;
    try {
      results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files });
    } catch {
      // Some embedded frames may be off-limits; fall back to the main page only.
      results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    }
    const filled = results.reduce((n, r) => n + ((r && r.result && r.result.filled) || 0), 0);
    status.textContent = filled
      ? `Filled ${filled} field${filled === 1 ? "" : "s"}. Review before submitting.`
      : "No matching empty fields found on this page.";
  } catch (e) {
    status.textContent = "Couldn't access this page: " + e.message;
  }
});
