// Shared autofill engine. Loaded into the page by the popup ("Fill this page") and by the
// auto-detect content script. Defines globalThis.JobAutofill = { scan, fill } once per page/frame.
if (!globalThis.JobAutofill) globalThis.JobAutofill = (() => {
  let profile = {};
  let overwrite = false;
  let customs = []; // custom questions with pre-computed tokens

  async function load() {
    const s = await chrome.storage.local.get(["profile", "settings"]);
    profile = s.profile || {};
    overwrite = !!(s.settings || {}).overwrite;
    customs = (profile.custom || [])
      .filter((x) => x && x.q && x.a)
      .map((x) => ({ q: norm(x.q), a: x.a, toks: tokens(x.q) }));
  }

  // ---------- helpers ----------
  const norm = (s) => (s || "").toString().toLowerCase().replace(/[‘’]/g, "'").replace(/[​ ]/g, " ").replace(/\s+/g, " ").trim();
  const textOf = (n) => (n ? (n.innerText || n.textContent || "") : "").replace(/[​]/g, "").replace(/\s+/g, " ").trim();
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DECLINE_RE = /decline|prefer not|don'?t wish|do not wish|not wish|choose not/;
  const PLACEHOLDER_RE = /^(select|choose|please select|please choose|pick|--|—|none selected|no selection)/;

  const isVisible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);

  // Poll fn() until it returns something truthy (and non-empty, for arrays) or the timeout passes.
  async function waitFor(fn, timeout = 1000, step = 50) {
    const end = Date.now() + timeout;
    for (;;) {
      const v = fn();
      if (v && (!Array.isArray(v) || v.length)) return v;
      if (Date.now() >= end) return null;
      await sleep(step);
    }
  }

  // ---------- fuzzy text matching ----------
  // Questions are compared word by word: filler words are dropped, word endings are ignored
  // ("sponsor" ~ "sponsorship", "authorised" ~ "authorized"), and small typos are tolerated.
  const STOP = new Set(("a an the and or of to in on at for with by from as is are was were be been being do does did have has had " +
    "you your yours we our us i me my it its this that these those what which who whom whose when where how why please will would " +
    "shall should can could may might any if there their they them he she his her am select required optional").split(" "));
  const SYNONYMS = { mobile: "phone", cell: "phone", telephone: "phone", tel: "phone", organisation: "company", organization: "company", employer: "company" };
  const SUFFIXES = ["ations", "ation", "ships", "ship", "ings", "ing", "ions", "ion", "ies", "ers", "er", "ed", "es", "s", "e"];
  const NEGATIONS = new Set(["not", "no", "dont", "never", "non"]);

  function tokens(s) {
    const words = norm(s).replace(/e-mail/g, "email").replace(/'/g, "").split(/[^a-z0-9+]+/);
    return [...new Set(words.filter((t) => t && !STOP.has(t)).map((t) => SYNONYMS[t] || t))];
  }
  function stem(t) {
    for (const s of SUFFIXES) if (t.length - s.length >= 4 && t.endsWith(s)) return t.slice(0, -s.length);
    return t;
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  function tokenMatch(a, b) {
    if (a === b) return true;
    if (/\d/.test(a) || /\d/.test(b)) return false;
    const sa = stem(a), sb = stem(b);
    if (sa === sb) return true;
    const [s, l] = sa.length <= sb.length ? [sa, sb] : [sb, sa];
    if (s.length >= 6 && l.startsWith(s)) return true; // "employ" ~ "employment", "disabl" ~ "disability"
    const m = Math.min(a.length, b.length);
    return m >= 5 && a[0] === b[0] && lev(a, b) <= (m >= 9 ? 2 : 1); // typos / spelling variants
  }
  // How much of question `q` (tokens) appears in text `t` (tokens): score = share of q's words found.
  function fuzzyScore(q, t) {
    if (!q.length) return { score: 0, hit: 0 };
    let hit = 0;
    for (const w of q) if (t.some((x) => tokenMatch(w, x))) hit++;
    return { score: hit / q.length, hit };
  }
  // "Most of" the question must match, and at least two words when the question has two or more.
  const fuzzyOk = (r, n, min) => r.score >= min && r.hit >= Math.min(2, n);
  const CUSTOM_MIN = 0.6;  // custom questions are written by the user, so they can be a bit looser
  const BUILTIN_MIN = 0.75;

  // Typical wordings of each profile question, used when no exact rule matches.
  const PHRASES = {
    firstName: ["first name", "given name"],
    middleName: ["middle name"],
    lastName: ["last name", "family name", "surname"],
    fullName: ["full legal name"],
    preferredName: ["preferred name"],
    pronouns: ["preferred pronouns"],
    email: ["email address"],
    phone: ["phone number"],
    address1: ["street address", "address line 1"],
    address2: ["address line 2", "apartment suite unit"],
    city: ["city"],
    state: ["state province"],
    zip: ["zip code", "postal code"],
    country: ["country of residence"],
    linkedin: ["linkedin profile"],
    github: ["github profile"],
    portfolio: ["portfolio website", "personal website"],
    currentCompany: ["current company", "most recent company"],
    currentTitle: ["current job title", "most recent job title"],
    yearsExperience: ["years of professional experience", "years of relevant experience"],
    school: ["school university attended"],
    degree: ["highest degree earned", "highest level of education"],
    major: ["field of study major"],
    gradYear: ["graduation year"],
    workAuthorized: ["legally authorized to work in this country", "eligible to work without restriction"],
    needsSponsorship: ["require visa sponsorship now or in the future", "need employment visa sponsorship"],
    over18: ["at least 18 years of age"],
    willingToRelocate: ["willing to relocate"],
    previouslyEmployed: ["previously employed by this company", "worked for this company before"],
    salary: ["desired salary expectations", "expected compensation"],
    startDate: ["earliest available start date", "notice period"],
    referralSource: ["how did you hear about this position", "referral source"],
    gender: ["gender identity"],
    hispanic: ["hispanic latino ethnicity"],
    race: ["race ethnicity", "racial background", "ethnic background"],
    veteran: ["protected veteran status"],
    disability: ["disability status"],
    summary: ["tell us about yourself", "professional summary"],
    coverLetter: ["cover letter"]
  };
  const PHRASE_TOKENS = Object.entries(PHRASES).flatMap(([key, list]) => list.map((p) => ({ key, toks: tokens(p) })));

  function computed(key) {
    const p = profile;
    switch (key) {
      case "fullName": return [p.firstName, p.lastName].filter(Boolean).join(" ");
      case "location": return [p.city, p.state].filter(Boolean).join(", ");
      default: return p[key];
    }
  }

  // ---------- rules: [profile key, pattern]; first match wins ----------
  const RULES = [
    ["email", /e-?mail/],
    ["linkedin", /linkedin/],
    ["github", /github/],
    ["twitter", /twitter|\bx\.com\b/],
    ["portfolio", /portfolio|personal (web)?site|website|\bblog\b|other url|\burl\b/],
    ["preferredName", /preferred (first )?name|nickname/],
    ["firstName", /first.?name|given.?name|\bfname\b/],
    ["middleName", /middle.?name/],
    ["lastName", /last.?name|surname|family.?name|\blname\b/],
    ["fullName", /full.?name|your name|legal name|^name\b/],
    ["pronouns", /pronoun/],
    // yes/no + EEO questions come before address rules ("this country", "united states"...)
    ["needsSponsorship", /sponsor/],
    ["workAuthorized", /authori[sz]ed to work|legally (authori[sz]ed|eligible|able|permitted) to work|eligib\w* to work|right to work|work authori[sz]ation/],
    ["over18", /18 years|at least 18|over 18|age of 18|\b18\+/],
    ["willingToRelocate", /relocat/],
    ["previouslyEmployed", /(previously|ever|have you) (been )?(worked|employed)|former employee|worked (for|at) .* before/],
    ["hispanic", /hispanic|latin[oax]/],
    ["race", /\brace\b|ethnicit/],
    ["gender", /gender|\bsex\b/],
    ["veteran", /veteran/],
    ["disability", /disabilit/],
    ["coverLetter", /cover letter/],
    ["summary", /about yourself|tell us about you|introduce yourself|professional summary|^summary|\bbio\b/],
    ["salary", /salary|compensation|pay expectation|desired pay/],
    ["startDate", /start date|available to start|when can you start|notice period|earliest start/],
    ["referralSource", /how did you (hear|find|learn)|where did you (hear|find|learn)|referral source/],
    ["yearsExperience", /years of (professional |relevant |work )?experience|how many years/],
    ["currentCompany", /(current|most recent|present) (company|employer)|^company\b|^employer\b|company name/],
    ["currentTitle", /(current|most recent|present) (job )?(title|role|position)|job title|^title\b/],
    ["school", /school|university|college|institution/],
    ["degree", /degree/],
    ["major", /major|field of study|discipline|area of study/],
    ["gradYear", /graduation|grad(uation)? (year|date)/],
    ["phone", /phone|mobile|cell\b|telephone|\btel\b/],
    ["address2", /address.?(line)?.?2|\bapt\b|apartment|suite|\bunit\b/],
    ["address1", /street|address.?(line)?.?1|^address|mailing address|home address/],
    ["location", /^location|current location|where are you (located|based)/],
    ["city", /\bcity\b|\btown\b/],
    ["zip", /\bzip|postal|post code|postcode/],
    ["state", /\bstate\b|province|region/],
    ["country", /country/]
  ];

  // Which profile answer belongs to a field labelled `label`? Returns { key, value } or null.
  // Order: custom question (exact words) > custom question (fuzzy) > built-in rule > built-in question (fuzzy).
  function matchFor(label) {
    const l = norm(label);
    if (!l) return null;
    for (const c of customs) if (l.includes(c.q)) return { key: "custom:" + c.q, value: c.a };

    const lt = tokens(l);
    let best = null;
    for (const c of customs) {
      const r = fuzzyScore(c.toks, lt);
      if (fuzzyOk(r, c.toks.length, CUSTOM_MIN) && (!best || r.score > best.score || (r.score === best.score && r.hit > best.hit))) best = { ...r, c };
    }
    if (best) return { key: "custom:" + best.c.q, value: best.c.a };

    for (const [key, re] of RULES) {
      if (re.test(l)) {
        const v = computed(key);
        return v ? { key, value: String(v) } : null;
      }
    }

    best = null;
    for (const p of PHRASE_TOKENS) {
      const r = fuzzyScore(p.toks, lt);
      if (fuzzyOk(r, p.toks.length, BUILTIN_MIN) && (!best || r.score > best.score || (r.score === best.score && r.hit > best.hit))) best = { ...r, key: p.key };
    }
    if (best) {
      const v = computed(best.key);
      return v ? { key: best.key, value: String(v) } : null;
    }
    return null;
  }
  const valueFor = (label) => { const m = matchFor(label); return m ? m.value : null; };

  // ---------- label discovery ----------
  function byIds(ids) {
    return (ids || "").split(/\s+/).map((id) => textOf(document.getElementById(id))).filter(Boolean).join(" ");
  }

  function primaryLabel(el) {
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map(textOf).join(" ");
      if (t) return t;
    }
    const lb = byIds(el.getAttribute("aria-labelledby"));
    if (lb) return lb;
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    const wrap = el.closest("label");
    if (wrap && textOf(wrap)) return textOf(wrap);
    if (el.placeholder && !PLACEHOLDER_RE.test(norm(el.placeholder))) return el.placeholder;
    // Fall back to nearby text: previous siblings of the element or its ancestors.
    let node = el;
    for (let i = 0; i < 4 && node; i++) {
      let sib = node.previousElementSibling;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length < 250) return t;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  function hintText(el) {
    return [el.name, el.id, el.getAttribute("autocomplete"), el.getAttribute("data-automation-id"), el.getAttribute("data-qa")]
      .filter(Boolean).join(" ").replace(/[_\-\[\]]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  function questionFor(el) {
    const p = primaryLabel(el);
    return valueFor(p) !== null ? p : (p + " | " + hintText(el));
  }

  // Question text for a radio group: look for fieldset legend, radiogroup label, or text above the options.
  function groupQuestion(radios) {
    const first = radios[0];
    const fs = first.closest("fieldset");
    if (fs) {
      const lg = fs.querySelector("legend");
      if (lg && textOf(lg)) return textOf(lg);
    }
    const rg = first.closest('[role="radiogroup"]');
    if (rg) {
      const t = byIds(rg.getAttribute("aria-labelledby")) || rg.getAttribute("aria-label");
      if (t) return t;
    }
    // Smallest ancestor containing every radio in the group.
    let box = first.parentElement;
    while (box && !radios.every((r) => box.contains(r))) box = box.parentElement;
    let node = box;
    for (let i = 0; i < 4 && node; i++) {
      let sib = node.previousElementSibling;
      while (sib) {
        const t = textOf(sib);
        if (t && t.length < 400) return t;
        sib = sib.previousElementSibling;
      }
      node = node.parentElement;
    }
    return "";
  }

  // ---------- choosing among options (select / radio / custom dropdown) ----------
  const US_STATES = "al alabama|ak alaska|az arizona|ar arkansas|ca california|co colorado|ct connecticut|de delaware|dc district of columbia|fl florida|ga georgia|hi hawaii|id idaho|il illinois|in indiana|ia iowa|ks kansas|ky kentucky|la louisiana|me maine|md maryland|ma massachusetts|mi michigan|mn minnesota|ms mississippi|mo missouri|mt montana|ne nebraska|nv nevada|nh new hampshire|nj new jersey|nm new mexico|ny new york|nc north carolina|nd north dakota|oh ohio|ok oklahoma|or oregon|pa pennsylvania|ri rhode island|sc south carolina|sd south dakota|tn tennessee|tx texas|ut utah|vt vermont|va virginia|wa washington|wv west virginia|wi wisconsin|wy wyoming"
    .split("|").map((s) => [s.slice(0, 2), s.slice(3)]);

  // Other ways a dropdown might spell the same answer: [test on the saved value, alternatives].
  const ALIASES = [
    [/^(united states( of america)?|usa?|u\.s\.(a\.)?|america)$/, ["united states", "united states of america", "usa", "us", "u.s."]],
    [/^(united kingdom|uk|u\.k\.|great britain|britain)$/, ["united kingdom", "uk", "great britain"]],
    [/^(united arab emirates|uae)$/, ["united arab emirates", "uae"]],
    [/^(south korea|korea|republic of korea)$/, ["south korea", "korea, republic of", "republic of korea", "korea"]],
    [/^(male|man)$/, ["male", "man"]],
    [/^(female|woman)$/, ["female", "woman"]],
    [/^non.?binary$/, ["non-binary", "nonbinary", "non binary"]],
    [/^(bachelor|b\.?[as]\.?$|bsc$)/, ["bachelor's degree", "bachelor's", "bachelors", "bachelor", "bachelor of science", "bachelor of arts", "ba", "bs"]],
    [/^(master|m\.?[as]\.?$|msc$)/, ["master's degree", "master's", "masters", "master", "master of science", "master of arts", "ms", "ma"]],
    [/^(ph\.?d|doctor)/, ["doctorate", "ph.d.", "phd", "doctoral degree", "doctor"]],
    [/^associate/, ["associate's degree", "associate's", "associates", "associate"]],
    [/^(high school|ged)/, ["high school diploma", "high school", "ged"]]
  ];

  function variants(v) {
    const out = [v];
    const add = (x) => { if (x && !out.includes(x)) out.push(x); };
    for (const [re, alts] of ALIASES) if (re.test(v)) alts.forEach(add);
    for (const [abbr, name] of US_STATES) {
      if (v === abbr) add(name);
      if (v === name) add(abbr);
    }
    return out;
  }

  const wordIn = (hay, needle) => new RegExp("(^|[^a-z0-9])" + esc(needle) + "($|[^a-z0-9])").test(hay);

  // Numeric answers against range options such as "0-1 years", "3 to 5", "10+", "Less than 1 year".
  function rangeMatch(list, v) {
    if (!/^\d+(\.\d+)?$/.test(v)) return null;
    const n = Number(v);
    return list.find((c) => {
      let m;
      if ((m = c.t.match(/(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/))) return n >= Number(m[1]) && n <= Number(m[2]);
      if ((m = c.t.match(/(\d+(?:\.\d+)?)\s*\+|(\d+(?:\.\d+)?)\s*(?:years? )?or more|(?:more|greater) than (\d+(?:\.\d+)?)|over (\d+(?:\.\d+)?)/))) {
        const a = Number(m[1] || m[2] || m[3] || m[4]);
        return m[3] || m[4] ? n > a : n >= a;
      }
      if ((m = c.t.match(/(?:less than|under|fewer than|<)\s*(\d+(?:\.\d+)?)/))) return n < Number(m[1]);
      if ((m = c.t.match(/^(\d+(?:\.\d+)?)\b/))) return n === Number(m[1]);
      return false;
    }) || null;
  }

  // Last resort: the option containing most of the answer's words ("Black or African American" ~
  // "Black/African-American"). An option with a "not"/"no" never matches an answer without one, and vice versa.
  function fuzzyOption(list, v) {
    const vt = tokens(v);
    if (!vt.length) return null;
    const neg = vt.some((t) => NEGATIONS.has(t));
    let best = null;
    for (const c of list) {
      const ct = tokens(c.t);
      if (ct.some((t) => NEGATIONS.has(t)) !== neg) continue;
      const r = fuzzyScore(vt, ct);
      if (fuzzyOk(r, vt.length, BUILTIN_MIN) && (!best || r.score > best.score || (r.score === best.score && ct.length < best.len))) best = { c, score: r.score, len: ct.length };
    }
    return best ? best.c : null;
  }

  function pickOption(choices, value) {
    const v = norm(value);
    if (!v) return null;
    const list = choices.map((c) => ({ ...c, t: norm(c.text) })).filter((c) => c.t && !PLACEHOLDER_RE.test(c.t));
    if (DECLINE_RE.test(v)) return list.find((c) => DECLINE_RE.test(c.t)) || null;
    const exact = variants(v);
    const hit = (pool, pred) => { for (const x of exact) { const c = pool.find((c) => pred(c, x)); if (c) return c; } return null; };
    // Outside of an exact match, never pick a "decline to answer" option for a real answer.
    const answers = list.filter((c) => !DECLINE_RE.test(c.t));
    return (
      hit(list, (c, x) => c.t === x) ||
      hit(answers, (c, x) => new RegExp("^" + esc(x) + "($|[^a-z0-9])").test(c.t)) ||
      hit(answers, (c, x) => c.t.length > 2 && x.length > 2 && (wordIn(c.t, x) || wordIn(x, c.t))) ||
      rangeMatch(answers, v) ||
      fuzzyOption(answers, v) ||
      null
    );
  }

  // ---------- writing values in a way React/Vue/Angular forms notice ----------
  function setValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  }
  function fire(el) {
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function setNative(el, value) {
    setValue(el, value);
    fire(el);
  }
  // Type into a search box without blurring it (a blur would close the dropdown menu).
  function typeInto(el, value) {
    setValue(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  }
  // A full pointer/mouse click sequence: custom dropdowns listen to different parts of it.
  function realClick(el) {
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...o, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", o));
    el.dispatchEvent(new PointerEvent("pointerup", { ...o, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", o));
    el.dispatchEvent(new MouseEvent("click", o));
  }
  const KEY_CODES = { ArrowDown: 40, Enter: 13, Escape: 27 };
  function press(el, key) {
    for (const type of ["keydown", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key, code: key, keyCode: KEY_CODES[key], which: KEY_CODES[key], bubbles: true, cancelable: true }));
    }
  }
  function mark(el) {
    el.style.outline = "2px solid #2e9e5b";
    el.style.outlineOffset = "1px";
    el.setAttribute("data-job-autofilled", "1");
  }

  // ---------- finding fields ----------
  const SKIP_TYPES = new Set(["hidden", "submit", "button", "reset", "file", "password", "image", "checkbox", "radio", "range", "color"]);

  // An <input> that is really the front end of a dropdown (React-Select, Ashby, MUI Autocomplete, ...).
  const isComboInput = (el) => el.getAttribute("role") === "combobox" || /^(list|both)$/.test(el.getAttribute("aria-autocomplete") || "");

  function textFields() {
    return [...document.querySelectorAll("input, textarea")].filter((el) =>
      !(el.tagName === "INPUT" && SKIP_TYPES.has((el.type || "text").toLowerCase())) &&
      !el.disabled && !el.readOnly && isVisible(el) && !isComboInput(el));
  }
  function fitsText(el, value) {
    if (el.type === "number" && isNaN(Number(value))) return false;
    return !(el.maxLength > 0 && value.length > el.maxLength);
  }

  // Native dropdowns. Libraries like select2 / chosen hide the real <select> and show their own widget
  // next to it; those hidden selects are still filled, and the widget next to them is skipped later.
  function selectFields() {
    const list = [];
    const hosts = [];
    for (const el of document.querySelectorAll("select")) {
      if (el.disabled) continue;
      let shown = el;
      if (!isVisible(el)) {
        const parent = el.parentElement;
        const sib = el.nextElementSibling;
        const backsWidget = parent && isVisible(parent) &&
          (/select2|chosen|selectize|tom-?select|choices|hidden-accessible|sr-only|visually-hidden/i.test(el.className) ||
           el.getAttribute("aria-hidden") === "true" || (sib && isVisible(sib)));
        if (!backsWidget) continue;
        shown = sib && isVisible(sib) ? sib : parent;
        hosts.push(shown);
      }
      list.push({ el, shown });
    }
    return { list, hosts };
  }
  const selectHasValue = (el) => el.selectedIndex > 0 && !!el.value;
  const selectChoices = (el) => [...el.options].map((o) => ({ text: o.text, el: o }));

  function radioGroups() {
    const groups = new Map();
    for (const r of document.querySelectorAll('input[type="radio"]')) {
      if (r.disabled) continue;
      const key = r.name || (r.closest('fieldset, [role="radiogroup"]') || r.parentElement?.parentElement);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return [...groups.values()];
  }
  const radioChoices = (radios) => radios.map((r) => ({ text: (r.labels && r.labels[0] ? textOf(r.labels[0]) : "") || r.getAttribute("aria-label") || r.value, el: r }));

  function customDropdowns(hosts) {
    const found = new Set();
    for (const el of document.querySelectorAll("input")) if (isComboInput(el) && !SKIP_TYPES.has((el.type || "text").toLowerCase())) found.add(el);
    for (const el of document.querySelectorAll('[role="combobox"]:not(input), button[aria-haspopup="listbox"], [role="button"][aria-haspopup="listbox"]')) {
      const inner = el.querySelector("input");
      if (inner && found.has(inner)) continue; // ARIA 1.1 wrapper around a combobox input: use the input
      found.add(el);
    }
    return [...found].filter((el) =>
      !el.closest('[role="listbox"], [role="option"], select') &&
      !hosts.some((h) => h.contains(el)));
  }
  const usable = (el) => el.isConnected && !el.disabled && el.getAttribute("aria-disabled") !== "true" && isVisible(el);

  // ---------- custom (non-<select>) dropdowns ----------
  // Option elements rendered by common dropdown libraries when their menu opens.
  const OPTION_SEL = '[role="option"], [id*="-option-"], [class*="__option"], [class*="-option"], [data-automation-id="promptOption"]';
  const optionOk = (o) => o.tagName !== "OPTION" && isVisible(o) && o.getAttribute("aria-disabled") !== "true" && !o.querySelector(OPTION_SEL);

  const allOptions = () => [...document.querySelectorAll(OPTION_SEL)].filter(optionOk);

  // The listbox the widget says it controls, if any.
  function listboxFor(el) {
    const owners = [el, el.closest('[role="combobox"]')].filter(Boolean);
    for (const o of owners) {
      for (const id of [o.getAttribute("aria-controls"), o.getAttribute("aria-owns")].join(" ").split(/\s+/)) {
        const lb = id && document.getElementById(id);
        if (lb && isVisible(lb)) return lb;
      }
    }
    return null;
  }

  // Options belonging to the menu this widget just opened. `before` = options visible before opening,
  // so unrelated option lists elsewhere on the page are ignored.
  function optionsFor(el, before) {
    const lb = listboxFor(el);
    if (lb) {
      const o = [...lb.querySelectorAll(OPTION_SEL)].filter(optionOk);
      if (o.length) return o;
    }
    const now = allOptions();
    const fresh = now.filter((o) => !before.has(o));
    if (fresh.length) return fresh;
    return el.getAttribute("aria-expanded") === "true" ? now : [];
  }

  const toChoice = (o) => ({ text: textOf(o) || o.getAttribute("aria-label") || "", el: o });

  // The text the widget currently shows as its selected value ("" if nothing chosen yet).
  function currentText(el) {
    let t = "";
    if (el.tagName === "INPUT") {
      // React-Select and similar render the chosen value next to the (empty) search input.
      // Stop climbing at the first value display found, or before reaching an ancestor that holds other fields.
      let n = el.parentElement;
      for (let i = 0; i < 4 && n; i++, n = n.parentElement) {
        if ([...n.querySelectorAll("input, select, textarea")].some((x) => x !== el && x.type !== "hidden")) break;
        const v = n.querySelector('[class*="singleValue"], [class*="single-value"], [class*="multiValue"], [class*="multi-value"], [class*="selection__rendered"]');
        if (v) { t = textOf(v); break; }
      }
      if (!t) t = el.value;
    } else {
      t = el.getAttribute("aria-valuetext") || textOf(el);
    }
    t = norm(t);
    return t && !PLACEHOLDER_RE.test(t) ? t : "";
  }

  // The element to outline once filled: the visible "control" box around a search input, or the widget itself.
  function widgetBox(el) {
    if (el.tagName !== "INPUT") return el;
    let n = el;
    for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
      if (/control/i.test(typeof n.className === "string" ? n.className : "") && isVisible(n)) return n;
    }
    return el;
  }

  function closeMenu(el) {
    for (const t of new Set([document.activeElement, el])) if (t && t !== document.body) press(t, "Escape");
  }

  async function fillCustom(el) {
    const value = valueFor(questionFor(el));
    if (value === null) return false;
    const current = currentText(el);
    if (current && !overwrite) return false;
    if (current && pickOption([{ text: current, el }], value)) return false; // already the right answer

    el.scrollIntoView({ block: "center" });
    const before = new Set(allOptions());

    // 1. Open the menu and look for the answer among the listed options.
    el.focus();
    realClick(el);
    let opts = await waitFor(() => optionsFor(el, before), 800);
    if (!opts) {
      press(el, "ArrowDown");
      opts = await waitFor(() => optionsFor(el, before), 600);
    }
    if (opts) await sleep(50); // let the list finish rendering
    let choice = opts && pickOption(optionsFor(el, before).map(toChoice), value);
    let sawOptions = !!opts;

    // 2. Not listed (long or search-as-you-type lists): type the answer into the search box and look again.
    let searchBox = null;
    if (!choice) {
      const active = document.activeElement;
      if (el.tagName === "INPUT" && !el.readOnly) searchBox = el;
      else if (active && active !== el && active.tagName === "INPUT" && !active.readOnly && isVisible(active)) searchBox = active;
      if (searchBox) {
        typeInto(searchBox, value);
        choice = await waitFor(() => {
          const o = optionsFor(el, before);
          if (o.length) sawOptions = true;
          return o.length ? pickOption(o.map(toChoice), value) : null;
        }, 2500);
      }
    }

    if (choice) {
      choice.el.scrollIntoView({ block: "nearest" });
      realClick(choice.el);
      await sleep(150);
      if (el.getAttribute("aria-expanded") === "true") closeMenu(el);
      if (document.activeElement === el || document.activeElement === searchBox) document.activeElement.blur();
      return true;
    }

    // 3. A plain autocomplete text box that never showed a menu: keep the typed text.
    if (searchBox === el && !sawOptions && el.getAttribute("aria-expanded") !== "true") {
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.blur();
      return true;
    }

    // No matching option: undo what we typed and close the menu.
    if (searchBox) typeInto(searchBox, "");
    closeMenu(el);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    return false;
  }

  // ---------- public: scan (count what could be filled, change nothing) ----------
  async function scan() {
    await load();
    const keys = new Set();
    let count = 0;
    const note = (m) => { if (m) { count++; keys.add(m.key); } };

    for (const el of textFields()) {
      if (el.value) continue;
      const m = matchFor(questionFor(el));
      if (m && fitsText(el, m.value)) note(m);
    }
    const { list, hosts } = selectFields();
    for (const { el } of list) {
      if (selectHasValue(el)) continue;
      const m = matchFor(questionFor(el));
      if (m && pickOption(selectChoices(el), m.value)) note(m);
    }
    for (const radios of radioGroups()) {
      if (radios.some((r) => r.checked)) continue;
      const m = matchFor(groupQuestion(radios));
      if (m && pickOption(radioChoices(radios), m.value)) note(m);
    }
    for (const el of customDropdowns(hosts)) {
      if (usable(el) && !currentText(el)) note(matchFor(questionFor(el)));
    }
    return { count, distinct: keys.size };
  }

  // ---------- public: fill ----------
  async function run() {
    await load();
    let filled = 0;

    for (const el of textFields()) {
      if (el.value && !overwrite) continue;
      const value = valueFor(questionFor(el));
      if (value === null || !fitsText(el, value)) continue;
      setNative(el, value);
      mark(el);
      filled++;
    }

    const { list, hosts } = selectFields();
    for (const { el, shown } of list) {
      if (!overwrite && selectHasValue(el)) continue;
      const value = valueFor(questionFor(el));
      if (value === null) continue;
      const opt = pickOption(selectChoices(el), value);
      if (!opt || (el.value === opt.el.value && el.selectedIndex > 0)) continue;
      setNative(el, opt.el.value);
      mark(shown);
      filled++;
    }

    for (const radios of radioGroups()) {
      if (!overwrite && radios.some((r) => r.checked)) continue;
      const value = valueFor(groupQuestion(radios));
      if (value === null) continue;
      const opt = pickOption(radioChoices(radios), value);
      if (!opt || opt.el.checked) continue;
      opt.el.click();
      mark(opt.el.labels && opt.el.labels[0] ? opt.el.labels[0] : opt.el);
      filled++;
    }

    // One at a time: only one menu can be open at once.
    for (const el of customDropdowns(hosts)) {
      if (!usable(el)) continue;
      try {
        if (await fillCustom(el)) {
          mark(widgetBox(el));
          filled++;
        }
      } catch (e) {
        // A widget we don't understand shouldn't stop the rest of the page.
      }
    }
    return { filled };
  }

  let busy = null; // the popup and the on-page prompt must not fill at the same time
  function fill() {
    if (!busy) busy = run().finally(() => { busy = null; });
    return busy;
  }

  return { scan, fill };
})();
