// Keeps the auto-detect content script registered only while the popup toggle is on
// and the user has granted access to all sites.
const SCRIPT_ID = "job-autofill-detect";
const ALL_SITES = { origins: ["<all_urls>"] };

let queue = Promise.resolve();
function sync(reRegister = false) {
  queue = queue.then(async () => {
    const { settings = {} } = await chrome.storage.local.get("settings");
    const granted = await chrome.permissions.contains(ALL_SITES);
    let existing = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (existing.length && (reRegister || !(settings.autoDetect && granted))) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      existing = [];
    }
    if (settings.autoDetect && granted && !existing.length) {
      await chrome.scripting.registerContentScripts([{
        id: SCRIPT_ID,
        matches: ["<all_urls>"],
        js: ["core.js", "detect.js"],
        allFrames: true,
        runAt: "document_idle"
      }]);
    }
  }).catch((e) => console.warn("Job Autofill: couldn't update auto-detect", e));
  return queue;
}

chrome.runtime.onInstalled.addListener(() => sync(true)); // re-register so updated files are picked up
chrome.runtime.onStartup.addListener(() => sync());
chrome.permissions.onAdded.addListener(() => sync());
chrome.permissions.onRemoved.addListener(() => sync());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    const before = (changes.settings.oldValue || {}).autoDetect;
    const after = (changes.settings.newValue || {}).autoDetect;
    if (before !== after) sync();
  }
});
