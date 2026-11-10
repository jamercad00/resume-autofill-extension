// Auto-detect (runs on every page while the popup's "Ask to autofill" toggle is on).
// Watches the page for application questions the profile can answer and, when enough are found,
// shows a small prompt asking whether to fill them. Nothing is filled without a click.
(() => {
  if (globalThis.__jobAutofillDetect) return;
  globalThis.__jobAutofillDetect = true;

  const MIN_QUESTIONS = 3; // distinct profile questions needed before asking (a newsletter box shouldn't trigger it)
  const pageKey = () => "jobAutofillHandled:" + location.href.split("#")[0];

  let state = "idle"; // idle | asking | filling
  let timer = null;
  let host = null;

  // A page counts as handled after "Fill" or "Not now". It's offered again only if the URL changes
  // or new answerable questions appear (e.g. the next step of a multi-page form).
  function handledCount() {
    try { const v = sessionStorage.getItem(pageKey()); return v === null ? -1 : Number(v); } catch { return -1; }
  }
  function setHandled(count) {
    try { sessionStorage.setItem(pageKey(), String(count)); } catch {}
  }

  async function check() {
    if (state !== "idle" || !globalThis.JobAutofill) return;
    const { settings = {}, profile } = await chrome.storage.local.get(["settings", "profile"]);
    if (!settings.autoDetect || !profile) return;
    if ((settings.neverHosts || []).includes(location.hostname)) return;
    const r = await globalThis.JobAutofill.scan();
    if (r.distinct < MIN_QUESTIONS) return;
    const prev = handledCount();
    if (prev >= 0 && r.count <= prev) return;
    ask(r.count);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => check().catch(() => {}), 1000);
  }

  // ---------- the prompt ----------
  function ui() {
    if (host && host.isConnected) return host.shadowRoot;
    host = document.createElement("job-autofill-prompt");
    host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; right: 16px; bottom: 16px;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .card { font: 14px/1.4 system-ui, sans-serif; color: #1d2433; background: #fff; border: 1px solid #d6dbe4;
                border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18); padding: 14px 16px; width: 290px; max-width: calc(100vw - 32px); box-sizing: border-box; }
        .title { font-weight: 600; margin: 0 0 4px; }
        .msg { margin: 0 0 12px; color: #4a5568; font-size: 13px; }
        .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        button { font: inherit; font-size: 13px; border-radius: 7px; padding: 7px 12px; cursor: pointer; border: 1px solid #ccd3de; background: #fff; color: #1d2433; }
        button.primary { background: #2e6be6; border-color: #2e6be6; color: #fff; font-weight: 600; }
        button.link { border: 0; background: none; color: #7a8599; padding: 7px 4px; margin-left: auto; text-decoration: underline; }
        button:disabled { opacity: .6; cursor: default; }
      </style>
      <div class="card" role="dialog" aria-label="Job Application Autofill">
        <p class="title"></p><p class="msg"></p><div class="row"></div>
      </div>`;
    document.documentElement.appendChild(host);
    return root;
  }

  function render(title, msg, buttons) {
    const root = ui();
    root.querySelector(".title").textContent = title;
    root.querySelector(".msg").textContent = msg;
    const row = root.querySelector(".row");
    row.textContent = "";
    for (const [label, cls, onClick] of buttons) {
      const b = document.createElement("button");
      b.textContent = label;
      if (cls) b.className = cls;
      b.onclick = onClick;
      row.appendChild(b);
    }
  }

  function close() {
    if (host) host.remove();
    host = null;
  }

  function ask(count) {
    state = "asking";
    render("Job application detected",
      `${count} question${count === 1 ? "" : "s"} on this page match your saved profile. Fill them in?`,
      [
        ["Fill", "primary", fillNow],
        ["Not now", "", () => { setHandled(count); state = "idle"; close(); }],
        ["Never on this site", "link", neverHere]
      ]);
  }

  async function fillNow() {
    state = "filling";
    render("Filling…", "Hang on, custom dropdowns take a moment.", []);
    let filled = 0;
    try {
      filled = (await globalThis.JobAutofill.fill()).filled;
    } finally {
      // Remember what's left unanswered so the prompt doesn't come straight back for the same fields.
      const left = await globalThis.JobAutofill.scan().catch(() => ({ count: 0 }));
      setHandled(left.count);
      state = "idle";
    }
    render(filled ? `Filled ${filled} field${filled === 1 ? "" : "s"}` : "Nothing filled",
      filled ? "Check the green-outlined fields before submitting." : "No matching empty fields were found.",
      [["OK", "", close]]);
    setTimeout(() => { if (state === "idle") close(); }, 8000);
  }

  async function neverHere() {
    const { settings = {} } = await chrome.storage.local.get("settings");
    settings.neverHosts = [...new Set([...(settings.neverHosts || []), location.hostname])];
    await chrome.storage.local.set({ settings });
    state = "idle";
    close();
  }

  // Forms on job sites are often rendered late or step by step, so keep watching the page.
  new MutationObserver((records) => {
    if (state !== "idle") return;
    if (records.every((r) => host && (r.target === host || host.contains(r.target)))) return;
    schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
