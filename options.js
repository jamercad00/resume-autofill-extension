const formEl = document.getElementById("form");
const qaEl = document.getElementById("qa");
const savedEl = document.getElementById("saved");

// Build the form from PROFILE_FIELDS (fields.js)
let grid;
for (const f of PROFILE_FIELDS) {
  if (f.section) {
    const sec = document.createElement("section");
    sec.innerHTML = `<h2></h2><div class="grid"></div>`;
    sec.querySelector("h2").textContent = f.section;
    grid = sec.querySelector(".grid");
    formEl.appendChild(sec);
    continue;
  }
  const wrap = document.createElement("div");
  if (f.type === "textarea" || (f.options && f.label.length > 30)) wrap.className = "full";
  const label = document.createElement("label");
  label.textContent = f.label;
  label.htmlFor = "f_" + f.key;
  let input;
  if (f.options) {
    input = document.createElement("select");
    for (const o of f.options) input.add(new Option(o || "—", o));
  } else if (f.type === "textarea") {
    input = document.createElement("textarea");
  } else {
    input = document.createElement("input");
    input.type = f.type || "text";
  }
  input.id = "f_" + f.key;
  input.dataset.key = f.key;
  // Browser autofill, two kinds:
  // - Fields with a standard type (name, email, phone, address, company, title) are filled from Chrome's
  //   saved addresses. All of them share one named section so a single pick fills every section on the
  //   page, not just the one you clicked in.
  // - Every other text field gets a stable name so Chrome remembers what you saved there and suggests it
  //   again (see the hidden-frame submit in save()).
  // Textareas aren't remembered by Chrome, and sending long text through the hidden frame is pointless.
  if (input.tagName !== "TEXTAREA") input.name = f.key;
  input.autocomplete = f.autocomplete ? "section-profile " + f.autocomplete : "on";
  wrap.append(label, input);
  grid.appendChild(wrap);
}

function addQA(q = "", a = "") {
  const row = document.createElement("div");
  row.className = "qa";
  row.innerHTML = `<input class="q" placeholder="Words in the question, e.g. security clearance"><textarea class="a" rows="1" placeholder="Your answer"></textarea><button type="button" title="Remove">×</button>`;
  row.querySelector(".q").value = q;
  row.querySelector(".a").value = a;
  row.querySelector("button").onclick = () => row.remove();
  qaEl.appendChild(row);
}

function readForm() {
  const profile = {};
  for (const el of formEl.querySelectorAll("[data-key]")) profile[el.dataset.key] = el.value.trim();
  profile.custom = [...qaEl.querySelectorAll(".qa")]
    .map((r) => ({ q: r.querySelector(".q").value.trim(), a: r.querySelector(".a").value.trim() }))
    .filter((x) => x.q && x.a);
  return profile;
}

function writeForm(profile = {}) {
  for (const el of formEl.querySelectorAll("[data-key]")) el.value = profile[el.dataset.key] || "";
  qaEl.innerHTML = "";
  (profile.custom || []).forEach((x) => addQA(x.q, x.a));
  if (!qaEl.children.length) addQA();
}

// Track unsaved edits (typing, or Chrome autofill filling several fields at once) so they aren't lost.
let dirty = false;
function markDirty() {
  dirty = true;
  savedEl.textContent = "Unsaved changes";
  savedEl.classList.add("dirty");
}
formEl.addEventListener("input", markDirty);
formEl.addEventListener("change", markDirty);
qaEl.addEventListener("input", markDirty);
qaEl.addEventListener("click", (e) => { if (e.target.closest("button")) markDirty(); }); // removed a question
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

async function save() {
  await chrome.storage.local.set({ profile: readForm() });
  dirty = false;
  savedEl.classList.remove("dirty");
  savedEl.textContent = "Saved ✓";
  setTimeout(() => { if (!dirty) savedEl.textContent = ""; }, 2000);
}

// Saving goes through a real form submission (Save button, Enter, or Ctrl+S). The form posts into a hidden
// frame (saved.html) so the page stays put, but Chrome sees a submitted form and remembers each field's
// value as a future autofill suggestion. The profile itself is stored by save().
formEl.addEventListener("submit", () => { save(); });
const submitAndSave = () => formEl.requestSubmit();

document.getElementById("addqa").onclick = () => { addQA(); markDirty(); };
document.getElementById("save").onclick = submitAndSave;
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); submitAndSave(); }
});

document.getElementById("export").onclick = () => {
  const blob = new Blob([JSON.stringify(readForm(), null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "job-autofill-profile.json";
  a.click();
};
const fileInput = document.getElementById("importFile");
document.getElementById("import").onclick = () => fileInput.click();
fileInput.onchange = async () => {
  try {
    writeForm(JSON.parse(await fileInput.files[0].text()));
    await save();
  } catch (e) {
    alert("That file couldn't be read as a profile: " + e.message);
  }
  fileInput.value = "";
};

chrome.storage.local.get("profile").then(({ profile }) => writeForm(profile));
