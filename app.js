// ---------------------------------------------------------------------------
// app.js  —  State, actions, rendering, persistence wiring
// Depends on: i18n.js (window.t, window.I18N), storage.js (window.Storage)
// ---------------------------------------------------------------------------

// ---- App state ----
window.lang = Storage.getLang();
let currentUser = Storage.getUser();
let currentView = "home"; // 'home' | 'inspection' | 'historique' | 'settings'
let zones = [];
let sessions = [];
let selectedZoneIds = [];   // zones included in the active inspection
let inspectionPicking = false; // transient UI flag: show the zone picker

// Inline-edit trackers (settings view)
let editingZoneId = null;
let editingItemId = null;
let editingNoteId = null; // "zoneId:itemId" when the note editor is open

// Folder/database status (refreshed from Storage)
let folderInfo = { supported: false, hasHandle: false, connected: false, name: "" };

// Inspector-defined threshold (%): a zone passes the analysis when its score >= this value
let passThreshold = 80;

// Non-conformities (auto-created from failed inspection items)
let ncs = [];
let ncSettings = { overdueDays: 7, recurrentThreshold: 3, defaultCorrectiveAction: "", autoCloseNCs: false };

// Sub-view toggles
let historySubView = "sessions"; // "sessions" | "ncs"
let analyticsSubView = "inspections"; // "inspections" | "ncs"

// NC detail view
let viewingNcId = null;

// Photo viewer
let viewingPhotoData = null;

// Load persisted data from the database (async). Render only after load so
// the UI can't mutate state before it's been read.

async function refreshFolderInfo() {
  folderInfo = await Storage.getFolderInfo();
}

function persist() {
  Storage.saveState({ zones: zones, sessions: sessions, selectedZoneIds: selectedZoneIds, passThreshold: passThreshold, ncs: ncs, ncSettings: ncSettings });
}

const DB_FILE = "audit-data.json";

function dbSectionHtml() {
  if (!folderInfo.supported) {
    return '<div class="db-section">' +
      '<p class="db-status">' + t("dbBuiltin") + "</p>" +
      '<p class="muted">' + t("dbNeedBrowser") + "</p>" +
    "</div>";
  }
  if (folderInfo.connected) {
    return '<div class="db-section">' +
      '<p class="db-status db-ok">' + t("databaseFile") + " <strong>" + escapeHtml(folderInfo.name) + "/" + DB_FILE + "</strong></p>" +
      '<button class="btn btn-light btn-sm" onclick="pickFolder()">' + ic("folder") + t("dbChange") + "</button>" +
    "</div>";
  }
  if (folderInfo.hasHandle) {
    return '<div class="db-section">' +
      '<button class="btn btn-primary" onclick="connectFolder()">' + ic("link") + t("dbConnect") + "</button>" +
      '<p class="muted">' + t("dbNeedBrowser") + "</p>" +
    "</div>";
  }
  return '<div class="db-section">' +
    '<button class="btn btn-primary" onclick="pickFolder()">' + ic("folder") + t("dbChoose") + "</button>" +
    '<p class="muted">' + t("dbNeedBrowser") + "</p>" +
  "</div>";
}

// ---- Utilities ----
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- Inline SVG icon set (offline, stroke-based) ----
const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9v11h5v-6h4v6h5V9"/></svg>',
  inspect: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="18" rx="2"/><path d="M9 4h6"/><path d="m9 13 2 2 4-4"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="18" r="2"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M4 19h16"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><path d="M8 3v5h7"/><path d="M8 21v-6h8v6"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1-4L17 4l3 3L8 19l-4 1z"/><path d="M15 6l3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v5M14 11v5"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 5 6v6c0 4.5 3 8 7 9 4-1 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13h5l2 3h2l2-3h5"/><path d="M4 13v6h16v-6"/><path d="M4 13 6.5 5h11L20 13"/></svg>',
  flag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 21V4"/><path d="M6 5h11l-2 3 2 3H6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="12" width="4" height="9"/><rect x="10" y="7" width="4" height="14"/><rect x="17" y="3" width="4" height="18"/></svg>'
};

function ic(name) {
  const svg = ICONS[name];
  return svg ? '<span class="svg-ic" aria-hidden="true">' + svg + "</span>" : "";
}

function navigate(view) {
  currentView = view;
  render();
}

function setLang(l) {
  window.lang = l;
  Storage.setLang(l);
  render();
}

function setUser(name) {
  const n = (name || "").trim();
  if (!n) { showToast(t("nameRequired")); return false; }
  currentUser = n;
  Storage.setUser(currentUser);
  const el = document.getElementById("user-display");
  if (el) el.textContent = currentUser;
  return true;
}

function submitName() {
  const input = document.getElementById("welcome-name-input");
  if (setUser(input.value)) {
    currentView = "home";
    render();
  }
}

function saveSettingsName() {
  const input = document.getElementById("settings-user-input");
  if (setUser(input.value)) {
    render();
    showToast(t("saved"));
  }
}

function saveThreshold() {
  const input = document.getElementById("settings-threshold-input");
  if (!input) return;
  let v = parseInt(input.value, 10);
  if (isNaN(v)) v = 80;
  v = Math.max(0, Math.min(100, v));
  passThreshold = v;
  persist();
  render();
  showToast(t("saved"));
}

function langSwitchHtml() {
  const l = window.lang;
  return (
    '<select class="lang-select" aria-label="' + t("language") + '" onchange="setLang(this.value)">' +
      '<option value="en"' + (l === "en" ? " selected" : "") + ">EN</option>" +
      '<option value="fr"' + (l === "fr" ? " selected" : "") + ">FR</option>" +
    "</select>"
  );
}

// ---- Toast (non-blocking notice) ----
function showToast(msg) {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function () { toast.remove(); }, 2600);
}

// ---- Lightweight confirm modal (replaces native confirm) ----
function confirmDialog(message, onYes) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML =
    '<div class="modal" role="dialog" aria-modal="true">' +
      '<p class="modal-message">' + escapeHtml(message) + "</p>" +
      '<div class="modal-actions">' +
        '<button class="btn btn-light" id="modal-cancel">' + t("cancel") + "</button>" +
        '<button class="btn btn-danger" id="modal-ok">' + t("confirmYes") + "</button>" +
      "</div>" +
    "</div>";
  document.body.appendChild(overlay);
  overlay.querySelector("#modal-ok").onclick = function () {
    overlay.remove();
    onYes();
  };
  function close() {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  }
  function onKey(e) {
    if (e.key === "Escape") close();
  }
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) close();
  });
  overlay.querySelector("#modal-ok").focus();
  overlay.querySelector("#modal-cancel").addEventListener("click", close);
}

// ---- SETTINGS: structure CRUD ----
function addZoneFromInput() {
  const input = document.getElementById("new-zone-input");
  const name = input.value.trim();
  if (!name) return;
  zones.push({
    zoneId: "zone-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    zoneName: name,
    type: "checklist",
    items: []
  });
  input.value = "";
  persist();
  render();
  showToast(t("zoneAdded"));
}


function deleteZone(zoneId) {
  confirmDialog(t("confirmDeleteZone"), function () {
    zones = zones.filter(function (z) { return z.zoneId !== zoneId; });
    persist();
    render();
    showToast(t("zoneDeleted"));
  });
}

function startRenameZone(zoneId) {
  editingZoneId = zoneId;
  editingItemId = null;
  render();
}
function saveZoneName(zoneId) {
  const input = document.getElementById("edit-zone-input");
  const name = input.value.trim();
  const zone = zones.find(function (z) { return z.zoneId === zoneId; });
  if (zone && name) zone.zoneName = name;
  editingZoneId = null;
  persist();
  render();
  showToast(t("saved"));
}
function cancelEdit() {
  editingZoneId = null;
  editingItemId = null;
  render();
}

function addItem(zoneId) {
  const input = document.getElementById("setting-input-" + zoneId);
  const text = input.value.trim();
  if (!text) return;
  const zone = zones.find(function (z) { return z.zoneId === zoneId; });
  if (!zone) return;
  zone.items.push({
    id: "item-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    text: text,
    status: "unchecked",
    checkedBy: null,
    checkedAt: null,
    note: "",
    noteColor: "red",
    tags: []
  });
  persist();
  render();
  showToast(t("itemAdded"));
}

function deleteItem(zoneId, itemId) {
  confirmDialog(t("confirmDeleteItem"), function () {
    const zone = zones.find(function (z) { return z.zoneId === zoneId; });
    if (zone) zone.items = zone.items.filter(function (i) { return i.id !== itemId; });
    persist();
    render();
    showToast(t("itemDeleted"));
  });
}

function startEditItem(zoneId, itemId) {
  editingItemId = itemId;
  editingZoneId = null;
  render();
}
function saveItemText(zoneId, itemId) {
  const input = document.getElementById("edit-item-input");
  const text = input.value.trim();
  const zone = zones.find(function (z) { return z.zoneId === zoneId; });
  const item = zone && zone.items.find(function (i) { return i.id === itemId; });
  if (item && text) item.text = text;
  editingItemId = null;
  persist();
  render();
  showToast(t("saved"));
}

var TAG_COLORS = ["#E53935","#FB8C00","#FDD835","#43A047","#1E88E5","#8E24AA","#5C6BC0","#795548"];

function addTagToItem(zoneId, itemId) {
  var nameInput = document.getElementById("tag-name-" + itemId);
  var name = nameInput.value.trim();
  if (!name) return;
  var colorBtn = document.querySelector(".tag-color-picker[data-item='" + itemId + "'] .tag-color-btn.active");
  var color = colorBtn ? colorBtn.getAttribute("data-color") : TAG_COLORS[0];
  var zone = zones.find(function (z) { return z.zoneId === zoneId; });
  var item = zone && zone.items.find(function (i) { return i.id === itemId; });
  if (!item) return;
  if (!item.tags) item.tags = [];
  item.tags.push({ name: name, color: color });
  persist();
  render();
}

function removeTagFromItem(zoneId, itemId, tagIndex) {
  var zone = zones.find(function (z) { return z.zoneId === zoneId; });
  var item = zone && zone.items.find(function (i) { return i.id === itemId; });
  if (!item || !item.tags) return;
  item.tags.splice(tagIndex, 1);
  persist();
  render();
}

function selectTagColor(itemId, color) {
  var picker = document.querySelector(".tag-color-picker[data-item='" + itemId + "']");
  if (!picker) return;
  var btns = picker.querySelectorAll(".tag-color-btn");
  for (var i = 0; i < btns.length; i++) btns[i].classList.remove("active");
  var active = picker.querySelector(".tag-color-btn[data-color='" + color + "']");
  if (active) active.classList.add("active");
}

function tagBadgesHtml(tags) {
  if (!tags || !tags.length) return "";
  return '<div class="tag-badges">' + tags.map(function (tag) {
    return '<span class="tag-badge" style="background:' + escapeHtml(tag.color) + '">' + escapeHtml(tag.name) + '</span>';
  }).join("") + '</div>';
}

// ---- INSPECTION actions ----
function setStatus(zoneId, itemId, status) {
  const zone = zones.find(function (z) { return z.zoneId === zoneId; });
  if (!zone) return;
  const item = zone.items.find(function (i) { return i.id === itemId; });
  if (!item) return;
  item.status = status;
  if (status === "unchecked") {
    item.checkedBy = null;
    item.checkedAt = null;
  } else {
    item.checkedBy = currentUser;
    item.checkedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
  }
  persist();
  updateItemRowDom(zoneId, itemId, item);
  updateProgressDom();
}

// In-place DOM refresh for one criterion (avoids a full re-render on every tap).
function updateItemRowDom(zoneId, itemId, item) {
  const row = document.getElementById("row-" + zoneId + "-" + itemId);
  if (!row) return;
  const ACT = { pass: "#2E7D32", no_pass: "#C0392B", unchecked: "#94A3B8" };
  row.querySelectorAll(".status-btn").forEach(function (b) {
    const st = b.getAttribute("data-st");
    const on = st === item.status;
    b.style.background = on ? ACT[st] : "#E9EEF3";
    b.style.color = on ? "#fff" : "#44556B";
  });
  const metaEl = row.querySelector(".item-meta");
  if (metaEl) {
    metaEl.classList.toggle("muted", !item.checkedAt);
    metaEl.innerHTML = item.checkedAt
      ? t("evaluatedBy") + " <strong>" + escapeHtml(item.checkedBy) + "</strong> " + t("on") + " " + escapeHtml(item.checkedAt)
      : t("pending");
  }
}

// Save a note for an item (no re-render so the textarea keeps focus).
let notePersistTimer = null;
function schedulePersist() {
  if (notePersistTimer) clearTimeout(notePersistTimer);
  notePersistTimer = setTimeout(function () { notePersistTimer = null; persist(); }, 400);
}
function setNote(zoneId, itemId, value) {
  var zone = zones.find(function (z) { return z.zoneId === zoneId; });
  if (!zone) return;
  var item = zone.items.find(function (i) { return i.id === itemId; });
  if (!item) return;
  item.note = value;
  schedulePersist();
}

// Set the color of a note ("red" or "green"); red is the default.
function setNoteColor(zoneId, itemId, color) {
  var zone = zones.find(function (z) { return z.zoneId === zoneId; });
  if (!zone) return;
  var item = zone.items.find(function (i) { return i.id === itemId; });
  if (!item) return;
  item.noteColor = (color === "green") ? "green" : "red";
  persist();
  render();
}
function noteColorOf(item) {
  return (item.noteColor === "green") ? "green" : "red";
}

// Open/close the inline note editor for a criterion.
function editNote(zoneId, itemId) {
  const key = zoneId + ":" + itemId;
  editingNoteId = (editingNoteId === key) ? null : key;
  render();
}
function saveNote() {
  editingNoteId = null;
  persist();
  render();
}

// ---- Capacitor native share or desktop blob download ----
function saveAndShare(name, blob, title) {
  if (window.Capacitor && window.Capacitor.Plugins.Filesystem && window.Capacitor.Plugins.Share) {
    var reader = new FileReader();
    reader.onload = async function () {
      try {
        var base64 = reader.result.split(",")[1];
        var result = await window.Capacitor.Plugins.Filesystem.writeFile({
          path: name,
          data: base64,
          directory: "CACHE"
        });
        await window.Capacitor.Plugins.Share.share({
          title: title || name,
          files: [result.uri],
          dialogTitle: title || name
        });
        showToast(t("pdfExported"));
      } catch (err) {
        showToast(t("exportError") + ": " + (err && err.message ? err.message : err));
      }
    };
    reader.readAsDataURL(blob);
  } else {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    showToast(t("pdfExported"));
  }
}

// ---- Data import / export ----
function exportFile() {
  var data = JSON.stringify({ zones: zones, sessions: sessions, passThreshold: passThreshold }, null, 2);
  var date = new Date().toISOString().slice(0, 10);
  var blob = new Blob([data], { type: "application/json" });
  saveAndShare("audit-export-" + date + ".json", blob, "audit-export-" + date + ".json");
}
function importFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  confirmDialog(t("confirmImport"), function () {
    Storage.importJSON(file)
      .then(function (data) {
        zones = data.zones || [];
        sessions = Array.isArray(data.sessions) ? data.sessions : [];
        selectedZoneIds = Array.isArray(data.selectedZoneIds) ? data.selectedZoneIds : [];
        ncs = Array.isArray(data.ncs) ? data.ncs : [];
        ncSettings = data.ncSettings && typeof data.ncSettings === "object" ? data.ncSettings : {};
        editingZoneId = null;
        editingItemId = null;
        persist();
        render();
        showToast(t("importSuccess"));
      })
      .catch(function () {
        showToast(t("importError"));
      });
  });
  input.value = "";
}

// ---- File-System database folder (on-disk database) ----
async function pickFolder() {
  try {
    const ok = await Storage.chooseFolder();
    if (!ok) return;
    const data = await Storage.loadState();
    if (data && Array.isArray(data.zones)) zones = data.zones;
    await refreshFolderInfo();
    persist();
    render();
    showToast(t("dbReady"));
  } catch (e) {
    showToast(t("fsError"));
  }
}

async function connectFolder() {
  try {
    const ok = await Storage.connectFolder();
    if (!ok) return;
    const data = await Storage.loadState();
    if (data && Array.isArray(data.zones)) zones = data.zones;
    await refreshFolderInfo();
    persist();
    render();
    showToast(t("dbReady"));
  } catch (e) {
    showToast(t("fsError"));
  }
}

// ---- Inspection helpers ----
function selectedZones() {
  return zones.filter(function (z) { return selectedZoneIds.indexOf(z.zoneId) !== -1; });
}

function formatDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function statusPill(status) {
  return '<span class="session-pill green">' + t("completed") + "</span>";
}

function zonesToLogs() {
  const allLogs = [];
  selectedZones().forEach(function (z) {
    z.items.forEach(function (i) {
      allLogs.push(Object.assign({}, i, { zoneName: z.zoneName, type: "checklist" }));
    });
  });
  return allLogs;
}

// ---- Inspection actions ----
function saveProgress() {
  persist();
  showToast(t("saved"));
}

function finishInspection() {
  const items = [];
  selectedZones().forEach(function (z) {
    z.items.forEach(function (i) {
      items.push({
        zoneName: z.zoneName,
        type: "checklist",
        text: i.text,
        status: i.status,
        checkedBy: i.checkedBy,
        checkedAt: i.checkedAt,
        note: i.note,
        noteColor: i.noteColor || "red",
        tags: i.tags || []
      });
    });
  });
  sessions.push({
    id: "sess-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
    finishedAt: new Date().toISOString(),
    status: "completed",
    inspector: currentUser,
    items: items
  });
  // The snapshot is safely saved in history; clear the in-progress form so a
  // second click can't create a duplicate session (lossless reset here).
  selectedZones().forEach(function (z) {
    z.items.forEach(function (i) {
      i.status = "unchecked";
      i.checkedBy = null;
      i.checkedAt = null;
      i.note = "";
      i.noteColor = "red";
    });
  });
  selectedZoneIds = [];
  inspectionPicking = false;
  persist();
  createNcsFromSession(sessions[sessions.length - 1]);
  showToast(t("sessionSaved"));
  navigate('historique');
}

// ---- Zone picker actions ----
function selectAllZones() {
  const boxes = document.querySelectorAll(".zone-check input");
  for (let i = 0; i < boxes.length; i++) boxes[i].checked = true;
}
function clearZoneSelection() {
  const boxes = document.querySelectorAll(".zone-check input");
  for (let i = 0; i < boxes.length; i++) boxes[i].checked = false;
}
function startInspectionFromPicker() {
  const boxes = document.querySelectorAll(".zone-check input");
  const checked = [];
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].checked) checked.push(boxes[i].value);
  }
  if (!checked.length) { showToast(t("noZonesSelected")); return; }
  var removedIds = selectedZoneIds.filter(function (id) { return checked.indexOf(id) === -1; });
  removedIds.forEach(function (id) {
    var zone = zones.find(function (z) { return z.zoneId === id; });
    if (zone) {
      zone.items.forEach(function (i) {
        i.status = "unchecked";
        i.checkedBy = null;
        i.checkedAt = null;
        i.note = "";
        i.noteColor = "red";
      });
    }
  });
  selectedZoneIds = checked;
  inspectionPicking = false;
  persist();
  render();
}
function changeZones() {
  inspectionPicking = true;
  render();
}
function cancelZonePicking() {
  inspectionPicking = false;
  render();
}

// ---- PDF export ----
function statusLabel(s) {
  return s === "pass" ? t("pass") : s === "no_pass" ? t("noPass") : t("notChecked");
}

function reportRowsHtml(logs) {
  if (logs.length === 0) return '<p class="muted">' + t("noCriteriaFound") + "</p>";
  return '<div class="report-list">' + logs.map(function (log) {
    const statusColor = log.status === "pass"
      ? "background:#E5F3EA;color:#1B5E20;"
      : log.status === "no_pass"
        ? "background:#FDE9E7;color:#B03025;"
        : "background:#EEF1F5;color:#44556B;";
    const meta = log.checkedAt
      ? t("evaluatedBy") + " <strong>" + escapeHtml(log.checkedBy) + "</strong> " + t("on") + " " + escapeHtml(log.checkedAt)
      : t("notEvaluated");
    const note = (log.note && String(log.note).trim())
      ? '<div class="report-note note-' + ((log.noteColor === "green") ? "green" : "red") + '"><strong>' + t("noteLabel") + ":</strong> " + escapeHtml(log.note) + "</div>"
      : "";
    return (
      '<div class="report-row">' +
        "<div class=\"report-info\">" +
          '<div class="report-zone">' + t("zone") + " " + escapeHtml(log.zoneName) + "</div>" +
          '<div class="report-text">' + escapeHtml(log.text) + "</div>" +
          tagBadgesHtml(log.tags) +
          '<div class="report-meta">' + meta + "</div>" +
          note +
        "</div>" +
        "<div class=\"report-status\"><span class=\"status-badge\" style=\"" + statusColor + "\">" + escapeHtml(statusLabel(log.status)) + "</span></div>" +
      "</div>"
    );
  }).join("") + "</div>";
}

function buildReportHtml(logs, meta) {
  return (
    '<h3 class="report-heading">' + escapeHtml(meta.title || t("reportTitle")) + "</h3>" +
    '<p class="report-date">' + escapeHtml(meta.dateLabel || t("generatedOn")) + " " + escapeHtml(meta.date || "") + "</p>" +
    summaryHtml(logs) +
    reportRowsHtml(logs)
  );
}

function exportReportPdf(logs, meta) {
  try {
  var doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  var W = 210, H = 297, ML = 14, MR = 14, CW = W - ML - MR;
  var HEADER_H = 9, TOP = 26, BOTTOM = H - 18;

  var NAVY = [27, 74, 110];
  var META_BG = [240, 245, 250], META_BORDER = [210, 220, 230];
  var SOFT_GREEN = [229, 243, 234], GREEN_TXT = [27, 94, 32];
  var SOFT_RED = [253, 233, 231], RED_TXT = [176, 48, 37];
  var SOFT_GREY = [238, 241, 245], GREY_TXT = [68, 85, 107];
  var GUTTER = { pass: [46, 125, 50], no_pass: [192, 57, 43], unchecked: [148, 163, 184] };
  var NOTE_RGB = { green: [27, 122, 46], red: [183, 28, 28] };
  var BAR_TRACK = [225, 230, 235];

  var title = meta.title || t("reportTitle");
  var dateStr = (meta.dateLabel || t("generatedOn")) + " " + (meta.date || "");
  var inspector = meta.inspector || "";
  var y = TOP;

  function ensure(h) { if (y + h > BOTTOM) { startPage(); y = TOP; } }

  function startPage() {
    doc.addPage();
    drawHeaderBand();
  }

  function truncate(str, maxW, fs) {
    doc.setFontSize(fs);
    if (doc.getTextWidth(str) <= maxW) return str;
    var s = String(str);
    while (s.length > 1 && doc.getTextWidth(s + "\u2026") > maxW) s = s.slice(0, -1);
    return s + "\u2026";
  }

  function drawHeaderBand() {
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.rect(0, 0, W, HEADER_H, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text(truncate(title, CW - 34, 8), ML, HEADER_H - 2.5);
    doc.text(t("pageLabel") + " " + doc.internal.getNumberOfPages(), W - MR, HEADER_H - 2.5, { align: "right" });
    doc.setTextColor(0);
  }

  function wrap(str, x, startY, maxW, fontSize, draw) {
    if (!str) return startY;
    doc.setFontSize(fontSize);
    var words = String(str).split(/\s+/);
    var line = "";
    var curY = startY;
    var dry = draw === false;
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + " " + words[i] : words[i];
      if (doc.getTextWidth(test) > maxW && line) {
        if (!dry) doc.text(line, x, curY);
        curY += fontSize * 0.45;
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) { if (!dry) doc.text(line, x, curY); curY += fontSize * 0.45; }
    return curY;
  }

  // ---- Symbol glyphs + layout helpers -----------------------------------
  var PT = 0.3528; // point -> mm (jsPDF font sizes are in points)
  var MARK = { pass: "\u2713", no_pass: "\u2717", unchecked: "\u2500" };
  function setMark() { doc.setFont("zapfdingbats", "normal"); }
  function markW(code, fs) { setMark(); doc.setFontSize(fs); return doc.getTextWidth(code); }

  var stats = {}, zoneOrder = [];
  var totalPass = 0, totalNoPass = 0, totalUnchecked = 0;
  logs.forEach(function (l) {
    var key = l.zoneName || t("zone");
    if (!stats[key]) { stats[key] = { name: key, pass: 0, noPass: 0, unchecked: 0 }; zoneOrder.push(key); }
    if (l.status === "pass") { stats[key].pass++; totalPass++; }
    else if (l.status === "no_pass") { stats[key].noPass++; totalNoPass++; }
    else { stats[key].unchecked++; totalUnchecked++; }
  });
  function zonePct(z) { var e = z.pass + z.noPass; return e > 0 ? (z.pass / e) * 100 : null; }
  var zonesPassed = 0;
  zoneOrder.forEach(function (k) { var p = zonePct(stats[k]); if (p !== null && p >= passThreshold) zonesPassed++; });

  // ---- Page 1 header band (every page keeps a header band for consistency)
  drawHeaderBand();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.text(truncate(title, CW, 20), ML, y);
  y += 10;

  // Meta box
  ensure(26);
  doc.setFillColor(META_BG[0], META_BG[1], META_BG[2]);
  doc.setDrawColor(META_BORDER[0], META_BORDER[1], META_BORDER[2]);
  doc.roundedRect(ML, y, CW, 18, 2, 2, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(70);
  doc.text(t("inspectorLabel") + ":  " + (inspector || "\u2014"), ML + 3, y + 6.5);
  doc.text(dateStr, ML + 3, y + 12.5);
  var rightInfo = t("zone") + " " + zoneOrder.length + "   \u2022   " + logs.length + " " + t("criteriaCount");
  doc.text(rightInfo, W - MR - 3, y + 6.5, { align: "right" });
  y += 24;

  // ---- Analysis section
  if (zoneOrder.length > 0) {
    ensure(22);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text(t("analysisTitle"), ML, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(t("thresholdLabel") + ": " + passThreshold + "%", W - MR, y, { align: "right" });
    y += 4;

    // Global count cards
    var cards = [
      { label: t("pass"), n: totalPass, fill: SOFT_GREEN, col: GREEN_TXT },
      { label: t("noPass"), n: totalNoPass, fill: SOFT_RED, col: RED_TXT },
      { label: t("notChecked"), n: totalUnchecked, fill: SOFT_GREY, col: GREY_TXT }
    ];
    var cardW = (CW - 8) / 3;
    ensure(18);
    var cardGlyph = [MARK.pass, MARK.no_pass, MARK.unchecked];
    cards.forEach(function (c, i) {
      var x = ML + i * (cardW + 4);
      doc.setFillColor(c.fill[0], c.fill[1], c.fill[2]);
      doc.roundedRect(x, y, cardW, 15, 2, 2, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(c.col[0], c.col[1], c.col[2]);
      doc.text(String(c.n), x + cardW / 2, y + 9, { align: "center" });
      // Centered "glyph + label" unit under the number
      var g = cardGlyph[i];
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(c.col[0], c.col[1], c.col[2]);
      var gw = doc.getTextWidth(g);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(90);
      var lw = doc.getTextWidth(c.label);
      var unit = gw + 1.5 + lw;
      var lx = x + cardW / 2 - unit / 2;
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(c.col[0], c.col[1], c.col[2]);
      doc.text(g, lx, y + 12.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(90);
      doc.text(c.label, lx + gw + 1.5, y + 12.5);
    });
    y += 18;

    // Standalone per-zone cards
    zoneOrder.forEach(function (k) {
      var z = stats[k];
      var p = zonePct(z);
      var passed = p !== null && p >= passThreshold;
      ensure(20);
      doc.setFillColor(META_BG[0], META_BG[1], META_BG[2]);
      doc.setDrawColor(META_BORDER[0], META_BORDER[1], META_BORDER[2]);
      doc.roundedRect(ML, y, CW, 16, 2, 2, "FD");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text(truncate(z.name, CW - 70, 9.5), ML + 4, y + 6.5);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(110);
      doc.text(z.pass + " " + t("pass") + "   \u00b7   " + z.noPass + " " + t("noPass") + "   \u00b7   " + z.unchecked + " " + t("notChecked"), ML + 4, y + 11);
      var neutral = p === null;
      var pctTxt = neutral ? "\u2014" : Math.round(p) + "%";
      var col = neutral ? GREY_TXT : (passed ? GREEN_TXT : RED_TXT);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.setTextColor(col[0], col[1], col[2]);
      doc.text(pctTxt, W - MR - 4, y + 8.5, { align: "right" });
      // Status pill, right-aligned with the percentage, glyph inside
      var pillTxt = neutral ? t("notVerified") : (passed ? t("pass") : t("noPass"));
      var pillMark = MARK[neutral ? "unchecked" : (passed ? "pass" : "no_pass")];
      var pfill = neutral ? SOFT_GREY : (passed ? SOFT_GREEN : SOFT_RED);
      var pcol = neutral ? GREY_TXT : (passed ? GREEN_TXT : RED_TXT);
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(7);
      doc.setTextColor(pcol[0], pcol[1], pcol[2]);
      var pgw = doc.getTextWidth(pillMark);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      var pw = pgw + 1.5 + doc.getTextWidth(pillTxt) + 6;
      var pillX = W - MR - 4 - pw;
      doc.setFillColor(pfill[0], pfill[1], pfill[2]);
      doc.roundedRect(pillX, y + 10.5, pw, 5, 1.2, 1.2, "F");
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(7);
      doc.setTextColor(pcol[0], pcol[1], pcol[2]);
      doc.text(pillMark, pillX + 3, y + 13.2);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(pcol[0], pcol[1], pcol[2]);
      doc.text(pillTxt, pillX + 3 + pgw + 1.5, y + 13.2);
      y += 18;
    });

    // General card (all zones) — zone pass-rate bar vs. the user threshold
    ensure(20);
    var zoneTotal = zoneOrder.length;
    var zoneRate = zoneTotal > 0 ? (zonesPassed / zoneTotal) * 100 : 0;
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.roundedRect(ML, y, CW, 15, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(t("zonesPassed") + ": " + zonesPassed + " / " + zoneTotal, ML + 4, y + 6);
    doc.text(t("conformity") + ": " + Math.round(zoneRate) + "%", W - MR - 4, y + 6, { align: "right" });
    var ztby = y + 9.5;
    var zcol = zoneRate >= passThreshold ? SOFT_GREEN : SOFT_RED;
    doc.setFillColor(BAR_TRACK[0], BAR_TRACK[1], BAR_TRACK[2]);
    doc.roundedRect(ML + 4, ztby, CW - 8, 3, 1.5, 1.5, "F");
    var zbw = (CW - 8) * (zoneRate / 100);
    if (zbw > 0) {
      doc.setFillColor(zcol[0], zcol[1], zcol[2]);
      doc.roundedRect(ML + 4, ztby, Math.max(zbw, 1), 3, 1.5, 1.5, "F");
    }
    y += 18;
  }

  // ---- Zone detail rows
  var lastZone = null;
  logs.forEach(function (log) {
    if (log.zoneName !== lastZone) {
      lastZone = log.zoneName;
      var zk = log.zoneName || t("zone");
      ensure(14);
      doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.roundedRect(ML, y - 4.5, CW, 8, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text(truncate(log.zoneName, CW - 40, 10), ML + 3, y + 0.6);
      // Icon-forward counts: ✓ pass  ✗ no-pass (right-aligned)
      var zh = stats[zk];
      var zPassN = String(zh.pass), zNoPassN = String(zh.noPass);
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(8);
      doc.setTextColor(170, 226, 173);
      var zgwP = doc.getTextWidth(MARK.pass);
      doc.setTextColor(235, 170, 162);
      var zgwX = doc.getTextWidth(MARK.no_pass);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      var zw1 = doc.getTextWidth(zPassN), zw2 = doc.getTextWidth(zNoPassN);
      var ztotal = zgwP + 1 + zw1 + 3 + zgwX + 1 + zw2;
      var zx = W - MR - 3 - ztotal;
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(8);
      doc.setTextColor(170, 226, 173);
      doc.text(MARK.pass, zx, y + 0.6);
      zx += zgwP + 1;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(zPassN, zx, y + 0.6);
      zx += zw1 + 3;
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(8);
      doc.setTextColor(235, 170, 162);
      doc.text(MARK.no_pass, zx, y + 0.6);
      zx += zgwX + 1;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(zNoPassN, zx, y + 0.6);
      y += 8;
    }

    // Pre-flight: measure the row (without drawing) so it never renders below
    // the footer, and anchor the status badge to the first text line.
    var _projY = y;
    _projY = wrap(log.text, ML + 6, _projY, CW - 55, 10, false);
    if (log.note && String(log.note).trim()) {
      _projY = wrap(log.note, ML + 20, _projY, CW - 20, 8.5, false);
    }
    ensure(_projY - y + 14);

    var g = GUTTER[log.status] || GUTTER.unchecked;
    doc.setFillColor(g[0], g[1], g[2]);
    doc.circle(ML + 1.2, y - 1.2, 1.1, "F");
    var firstY = y;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(30);
    y = wrap(log.text, ML + 6, y, CW - 55, 10, true);

    if (log.tags && log.tags.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      var tagStr = log.tags.map(function (tg) { return tg.name; }).join(" | ");
      var tc = log.tags[0];
      var tcr = parseInt(tc.color.slice(1, 3), 16) || 100;
      var tcg = parseInt(tc.color.slice(3, 5), 16) || 100;
      var tcb = parseInt(tc.color.slice(5, 7), 16) || 100;
      doc.setTextColor(tcr, tcg, tcb);
      y = wrap(tagStr, ML + 6, y, CW - 55, 6);
      doc.setTextColor(30);
    }

    var sc, sr, sg, sb;
    if (log.status === "pass") { sc = GREEN_TXT; sr = SOFT_GREEN[0]; sg = SOFT_GREEN[1]; sb = SOFT_GREEN[2]; }
    else if (log.status === "no_pass") { sc = RED_TXT; sr = SOFT_RED[0]; sg = SOFT_RED[1]; sb = SOFT_RED[2]; }
    else { sc = GREY_TXT; sr = SOFT_GREY[0]; sg = SOFT_GREY[1]; sb = SOFT_GREY[2]; }
    var statusText = statusLabel(log.status).toUpperCase();
    var statusMark = MARK[log.status] || MARK.unchecked;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(sc[0], sc[1], sc[2]);
    doc.setFillColor(sr, sg, sb);
    var textRight = ML + 6 + (CW - 55);
    var badgeMax = (W - MR - 2) - textRight - 4;
    doc.setFont("zapfdingbats", "normal");
    doc.setFontSize(8);
    var mgw = doc.getTextWidth(statusMark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    var stw = doc.getTextWidth(statusText);
    var badgeW = mgw + 1.5 + stw + 7;
    if (badgeW > badgeMax) { mgw = 0; badgeW = stw + 7; } // drop the mark if the badge would crowd the row
    var bsw = Math.min(badgeW, badgeMax);
    var bx = ML + CW - bsw - 2;
    doc.roundedRect(bx, firstY - 4.5, bsw, 6.5, 1.5, 1.5, "F");
    var tx = bx + 1;
    if (mgw > 0) {
      doc.setFont("zapfdingbats", "normal");
      doc.setFontSize(8);
      doc.setTextColor(sc[0], sc[1], sc[2]);
      doc.text(statusMark, tx, firstY);
      tx += mgw + 1.5;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(sc[0], sc[1], sc[2]);
    doc.text(statusText, tx, firstY);
    y += 3;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    var metaText = log.checkedAt
      ? t("evaluatedBy") + " " + (log.checkedBy || "") + " " + t("on") + " " + log.checkedAt
      : t("notEvaluated");
    doc.text(metaText, ML + 6, y);
    y += 4;

    if (log.note && String(log.note).trim()) {
      var nr = NOTE_RGB[(log.noteColor === "green") ? "green" : "red"];
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(nr[0], nr[1], nr[2]);
      doc.text(t("noteLabel") + ":", ML + 6, y);
      doc.setFont("helvetica", "normal");
      y = wrap(log.note, ML + 20, y, CW - 20, 8.5);
    }
    y += 5;
  });

  // ---- Signature block
  ensure(22);
  y += 4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text(t("signatureLine"), ML, y);
  doc.setLineWidth(0.3);
  doc.setDrawColor(150);
  doc.line(ML, y + 3, ML + 55, y + 3);
  y += 14;

  // ---- Page headers validate + footers (patched post-pass)
  var total = doc.internal.getNumberOfPages();
  for (var pg = 1; pg <= total; pg++) {
    doc.setPage(pg);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(140);
    doc.setDrawColor(200, 205, 210);
    doc.setLineWidth(0.3);
    doc.line(ML, H - 12, W - MR, H - 12);
    doc.text(dateStr, ML, H - 8);
    doc.text(t("pageLabel") + " " + pg + " / " + total, W - MR, H - 8, { align: "right" });
  }

  var safeName = title.replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "_") || "audit-report";
  var blob = doc.output("blob");
  saveAndShare(safeName + ".pdf", blob, title);
  } catch (err) {
    showToast(t("exportError") + ": " + (err && err.message ? err.message : err));
  }
}
function exportInspectionPDF() {
  exportReportPdf(zonesToLogs(), {
    title: t("reportTitle"),
    dateLabel: t("generatedOn"),
    date: new Date().toLocaleString(),
    inspector: currentUser
  });
}

function exportSessionPDF(sessionId) {
  const s = sessions.find(function (x) { return x.id === sessionId; });
  if (!s) return;
  exportReportPdf(s.items || [], {
    title: t("reportTitle"),
    dateLabel: t("finishedOn"),
    date: formatDateTime(s.finishedAt),
    inspector: s.inspector || ""
  });
}

function deleteSession(id) {
  confirmDialog(t("confirmDeleteSession"), function () {
    sessions = sessions.filter(function (s) { return s.id !== id; });
    persist();
    render();
    showToast(t("sessionDeleted"));
  });
}

function clearHistory() {
  confirmDialog(t("confirmClearHistory"), function () {
    sessions = [];
    persist();
    render();
    showToast(t("historyCleared"));
  });
}

function toggleReport(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const hidden = el.classList.toggle("collapsed");
  btn.innerHTML = ic("eye") + (hidden ? t("viewReport") : t("hideReport"));
}

// ---- Analytics helpers ----
var MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function computeMonthlyStats(zoneName) {
  var now = new Date();
  var months = [];
  for (var i = 11; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    months.push({ key: key, label: MONTH_NAMES[d.getMonth()], year: d.getFullYear(), pass: 0, noPass: 0, unchecked: 0, total: 0 });
  }
  var cutoff = new Date(now.getFullYear(), now.getMonth() - 11, 1).getTime();
  sessions.forEach(function (s) {
    if (!s.finishedAt) return;
    var sd = new Date(s.finishedAt).getTime();
    if (sd < cutoff) return;
    var sk = s.finishedAt.slice(0, 7);
    var m = null;
    for (var j = 0; j < months.length; j++) { if (months[j].key === sk) { m = months[j]; break; } }
    if (!m) return;
    (s.items || []).forEach(function (item) {
      if (zoneName && item.zoneName !== zoneName) return;
      m.total++;
      if (item.status === "pass") m.pass++;
      else if (item.status === "no_pass") m.noPass++;
      else m.unchecked++;
    });
  });
  months.forEach(function (m) {
    var evaluated = m.pass + m.noPass;
    m.rate = evaluated > 0 ? Math.round((m.pass / evaluated) * 100) : null;
  });
  return months;
}

function analyticsSummary(months) {
  var totalSessions = 0;
  var rates = [];
  var best = null, worst = null;
  sessions.forEach(function (s) {
    if (!s.finishedAt) return;
    var sd = new Date(s.finishedAt).getTime();
    var cutoff = new Date(new Date().getFullYear(), new Date().getMonth() - 11, 1).getTime();
    if (sd < cutoff) return;
    totalSessions++;
  });
  months.forEach(function (m) {
    if (m.rate === null) return;
    rates.push(m);
  });
  if (rates.length) {
    best = rates[0]; worst = rates[0];
    rates.forEach(function (r) {
      if (r.rate > best.rate) best = r;
      if (r.rate < worst.rate) worst = r;
    });
  }
  var sum = 0;
  rates.forEach(function (r) { sum += r.rate; });
  var avg = rates.length ? Math.round(sum / rates.length) : null;
  return { totalSessions: totalSessions, avg: avg, best: best, worst: worst };
}

function renderBarChart(months) {
  var h = '<div class="analytics-chart">';
  months.forEach(function (m) {
    var pct = m.rate !== null ? m.rate : 0;
    var color = m.rate === null ? "grey" : (m.rate >= passThreshold ? "green" : "red");
    var pctLabel = m.rate !== null ? m.rate + "%" : "—";
    h += '<div class="analytics-bar-col">' +
      '<span class="analytics-pct">' + pctLabel + '</span>' +
      '<div class="analytics-bar ' + color + '" style="height:' + pct + '%"></div>' +
      '<span class="analytics-month">' + m.label + '<br><span class="year">' + (String(m.year).slice(2)) + '</span></span>' +
    '</div>';
  });
  h += '</div>';
  return h;
}

function analyticsStatHtml(label, value) {
  return '<div class="analytics-stat"><div class="value">' + value + '</div><div class="label">' + label + '</div></div>';
}

function analyticsViewHtml() {
  if (!sessions.length) {
    return '<div class="analytics-empty"><p>' + t("analyticsNoData") + '</p></div>';
  }
  var general = computeMonthlyStats(null);
  var genSummary = analyticsSummary(general);
  var thresholdPct = passThreshold + "%";
  var content = '';

  // General section
  var genStats = analyticsStatHtml(t("analyticsTotalSessions"), genSummary.totalSessions) +
    analyticsStatHtml(t("analyticsAvgRate"), genSummary.avg !== null ? genSummary.avg + "%" : "—") +
    analyticsStatHtml(t("analyticsBestMonth"), genSummary.best ? genSummary.best.rate + "% (" + genSummary.best.label + ")" : "—") +
    analyticsStatHtml(t("analyticsWorstMonth"), genSummary.worst ? genSummary.worst.rate + "% (" + genSummary.worst.label + ")" : "—");
  content += '<div class="analytics-section">' +
    '<h3 class="analytics-section-title">' + t("analyticsGeneral") + '</h3>' +
    '<div class="analytics-stats-row">' + genStats + '</div>' +
    '<div style="position:relative">' +
      '<div class="analytics-threshold" style="bottom:calc(' + passThreshold + '% - 1px)"></div>' +
      '<div class="analytics-threshold-label" style="bottom:calc(' + passThreshold + '% + 2px)">' + t("analyticsThreshold") + ' ' + thresholdPct + '</div>' +
      renderBarChart(general) +
    '</div>' +
  '</div>';

  // Per-zone sections
  var zoneNames = [];
  zones.forEach(function (z) { zoneNames.push(z.zoneName); });
  zoneNames.forEach(function (zn) {
    var zd = computeMonthlyStats(zn);
    var zSummary = analyticsSummary(zd);
    var hasData = false;
    zd.forEach(function (m) { if (m.total > 0) hasData = true; });
    if (!hasData) return;
    var zStats = analyticsStatHtml(t("analyticsTotalSessions"), zSummary.totalSessions) +
      analyticsStatHtml(t("analyticsAvgRate"), zSummary.avg !== null ? zSummary.avg + "%" : "—") +
      analyticsStatHtml(t("analyticsBestMonth"), zSummary.best ? zSummary.best.rate + "% (" + zSummary.best.label + ")" : "—") +
      analyticsStatHtml(t("analyticsWorstMonth"), zSummary.worst ? zSummary.worst.rate + "% (" + zSummary.worst.label + ")" : "—");
    content += '<div class="analytics-section">' +
      '<h3 class="analytics-section-title">' + escapeHtml(zn) + '</h3>' +
      '<div class="analytics-stats-row">' + zStats + '</div>' +
      '<div style="position:relative">' +
        '<div class="analytics-threshold" style="bottom:calc(' + passThreshold + '% - 1px)"></div>' +
        renderBarChart(zd) +
      '</div>' +
    '</div>';
  });

  return content;
}

function exportAnalyticsPdf() {
  try {
    var doc = new window.jspdf.jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    var W = 210, H = 297, ML = 14, MR = 14, CW = W - ML - MR;
    var HEADER_H = 9, TOP = 26, BOTTOM = H - 18;
    var NAVY = [27, 74, 110];
    var BAR_GREEN = [46, 125, 50], BAR_RED = [192, 57, 43], BAR_GREY = [224, 228, 234];
    var dateStr = new Date().toLocaleString();
    var y = TOP;

    function ensure(h) { if (y + h > BOTTOM) { startPage(); y = TOP; } }
    function startPage() { doc.addPage(); drawHeaderBand(); }
    function truncate(str, maxW, fs) {
      doc.setFontSize(fs);
      if (doc.getTextWidth(str) <= maxW) return str;
      var s = String(str);
      while (s.length > 1 && doc.getTextWidth(s + "\u2026") > maxW) s = s.slice(0, -1);
      return s + "\u2026";
    }
    function drawHeaderBand() {
      doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.rect(0, 0, W, HEADER_H, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(255, 255, 255);
      doc.text(truncate(t("analyticsTitle"), CW - 34, 8), ML, HEADER_H - 2.5);
      doc.text(t("pageLabel") + " " + doc.internal.getNumberOfPages(), W - MR, HEADER_H - 2.5, { align: "right" });
      doc.setTextColor(0);
    }

    function drawSectionChart(title, months, summary) {
      ensure(52);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
      doc.text(title, ML, y);
      y += 5;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(80);
      var statsText = t("analyticsTotalSessions") + ": " + summary.totalSessions +
        "   |   " + t("analyticsAvgRate") + ": " + (summary.avg !== null ? summary.avg + "%" : "\u2014") +
        "   |   " + t("analyticsBestMonth") + ": " + (summary.best ? summary.best.rate + "% (" + summary.best.label + ")" : "\u2014") +
        "   |   " + t("analyticsWorstMonth") + ": " + (summary.worst ? summary.worst.rate + "% (" + summary.worst.label + ")" : "\u2014");
      doc.text(statsText, ML, y);
      y += 7;

      var chartH = 40;
      var barGap = 2;
      var barW = (CW - barGap * 11) / 12;
      var chartBottom = y + chartH;

      doc.setDrawColor(200, 205, 210);
      doc.setLineWidth(0.2);
      doc.line(ML, chartBottom, W - MR, chartBottom);

      months.forEach(function (m, i) {
        var bx = ML + i * (barW + barGap);
        var rate = m.rate;
        var barH = rate !== null ? (rate / 100) * chartH : 0;
        var barY = chartBottom - barH;
        var col = rate === null ? BAR_GREY : (rate >= passThreshold ? BAR_GREEN : BAR_RED);

        doc.setFillColor(col[0], col[1], col[2]);
        if (barH > 0) doc.roundedRect(bx, barY, barW, barH, 1, 1, "F");

        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        if (rate !== null) {
          doc.setTextColor(col[0], col[1], col[2]);
          doc.text(rate + "%", bx + barW / 2, barY - 2, { align: "center" });
        } else {
          doc.setTextColor(160);
          doc.text("\u2014", bx + barW / 2, chartBottom - 3, { align: "center" });
        }

        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(100);
        doc.text(m.label, bx + barW / 2, chartBottom + 4, { align: "center" });
      });

      var thresholdY = chartBottom - (passThreshold / 100) * chartH;
      doc.setDrawColor(192, 57, 43);
      doc.setLineWidth(0.4);
      doc.line(ML, thresholdY, W - MR, thresholdY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.5);
      doc.setTextColor(192, 57, 43);
      doc.text(t("analyticsThreshold") + " " + passThreshold + "%", W - MR, thresholdY - 1.5, { align: "right" });

      y = chartBottom + 10;
    }

    drawHeaderBand();

    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.text(truncate(t("analyticsTitle"), CW, 18), ML, y);
    y += 8;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text(t("generatedOn") + " " + dateStr, ML, y);
    y += 8;

    var general = computeMonthlyStats(null);
    var genSummary = analyticsSummary(general);
    drawSectionChart(t("analyticsGeneral"), general, genSummary);

    var zoneNames = [];
    zones.forEach(function (z) { zoneNames.push(z.zoneName); });
    zoneNames.forEach(function (zn) {
      var zd = computeMonthlyStats(zn);
      var zSummary = analyticsSummary(zd);
      var hasData = false;
      zd.forEach(function (m) { if (m.total > 0) hasData = true; });
      if (!hasData) return;
      drawSectionChart(truncate(zn, CW, 11), zd, zSummary);
    });

    var total = doc.internal.getNumberOfPages();
    for (var pg = 1; pg <= total; pg++) {
      doc.setPage(pg);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(140);
      doc.setDrawColor(200, 205, 210);
      doc.setLineWidth(0.3);
      doc.line(ML, H - 12, W - MR, H - 12);
      doc.text(dateStr, ML, H - 8);
      doc.text(t("pageLabel") + " " + pg + " / " + total, W - MR, H - 8, { align: "right" });
    }

    var blob = doc.output("blob");
    saveAndShare("analytics-report.pdf", blob, t("analyticsTitle"));
  } catch (err) {
    showToast(t("exportError") + ": " + (err && err.message ? err.message : err));
  }
}

// ---- APP SHELL (header + navigation) ----
function navItem(id, label) {
  const icons = { home: "home", inspection: "inspect", historique: "history", settings: "settings", analytics: "chart" };
  return '<button class="nav-item' + (currentView === id ? " active" : "") + '" onclick="navigate(\'' + id + '\')">' + ic(icons[id] || "list") + '<span class="nav-label">' + label + "</span></button>";
}
function shell(content) {
  return (
    '<header class="app-header">' +
      '<span class="app-brand">' + ic("shield") + escapeHtml(t("appTitle")) + ' <span class="version-badge">v18</span></span>' +
      '<span class="app-user">' + ic("user") + escapeHtml(currentUser) + "</span>" +
      langSwitchHtml() +
    "</header>" +
    '<main class="app-main view">' + content + "</main>" +
    '<nav class="app-nav" aria-label="navigation">' +
      navItem("home", t("navHome")) +
      navItem("inspection", t("navInspect")) +
      navItem("historique", t("navHistory")) +
      navItem("analytics", t("navAnalytics")) +
      navItem("settings", t("navSettings")) +
    "</nav>"
  );
}

// ---- Inspection progress ----
function progressCounts() {
  let total = 0, done = 0;
  selectedZones().forEach(function (z) {
    z.items.forEach(function (i) {
      total++;
      if (i.status !== "unchecked") done++;
    });
  });
  return { total: total, done: done };
}

function progressHtml() {
  const c = progressCounts();
  if (c.total === 0) return "";
  const pct = Math.round((c.done / c.total) * 100);
  return (
    '<div class="progress-wrap">' +
      '<div class="progress-bar" role="progressbar" id="progress-bar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="progress-fill" id="progress-fill" style="width:' + pct + '%"></div>' +
      "</div>" +
      '<span class="progress-label" id="progress-label">' + c.done + "/" + c.total + " " + t("evaluated") + "</span>" +
    "</div>"
  );
}

// Per-zone completion chip shown in the active inspection.
function zoneProgressLabel(zone) {
  let total = 0, done = 0;
  zone.items.forEach(function (i) { total++; if (i.status !== "unchecked") done++; });
  if (total === 0) return "";
  const cls = (done === total) ? "zone-progress done" : "zone-progress";
  return '<span id="zone-progress-' + zone.zoneId + '" class="' + cls + '">' + done + "/" + total + "</span>";
}

// Refresh the progress bar + per-zone chips without a full re-render.
function updateProgressDom() {
  const c = progressCounts();
  const bar = document.getElementById("progress-bar");
  const fill = document.getElementById("progress-fill");
  const label = document.getElementById("progress-label");
  if (fill && label) {
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    fill.style.width = pct + "%";
    label.textContent = c.done + "/" + c.total + " " + t("evaluated");
    if (bar) bar.setAttribute("aria-valuenow", String(pct));
  }
  selectedZones().forEach(function (z) {
    const el = document.getElementById("zone-progress-" + z.zoneId);
    if (el) el.outerHTML = zoneProgressLabel(z);
  });
}

// ---- History summary chips ----
function summaryHtml(logs) {
  let pass = 0, noPass = 0, unchecked = 0;
  logs.forEach(function (l) {
    if (l.status === "pass") pass++;
    else if (l.status === "no_pass") noPass++;
    else unchecked++;
  });
  if (logs.length === 0) return "";
  return (
    '<div class="summary-chips">' +
      '<span class="chip chip-pass">' + pass + " " + t("pass") + "</span>" +
      '<span class="chip chip-fail">' + noPass + " " + t("noPass") + "</span>" +
      '<span class="chip chip-other">' + unchecked + " " + t("notChecked") + "</span>" +
    "</div>"
  );
}

function emptyState(msg, btnLabel, btnTarget, iconName) {
  const btn = btnLabel
    ? '<button class="btn btn-primary" onclick="navigate(\'' + btnTarget + '\')">' + ic(iconName || "list") + btnLabel + "</button>"
    : "";
  return '<div class="empty-state">' + ic(iconName || "inbox") + "<p>" + msg + "</p>" + btn + "</div>";
}

// ---- RENDER ENGINE ----
function render() {
  const app = document.getElementById("app");
  let content = "";

  if (currentView === "welcome") {
    app.innerHTML =
      '<div class="card home-card">' +
        '<div class="home-top">' + langSwitchHtml() + "</div>" +
        '<h2 class="home-title">' + t("appTitle") + "</h2>" +
        "<h3>" + t("welcomeTitle") + "</h3>" +
        '<p class="muted">' + t("welcomeSubtitle") + "</p>" +
        '<div class="add-zone-row">' +
          "<input id=\"welcome-name-input\" class=\"text-input\" type=\"text\" placeholder=\"" + t("inspectorName") + "\" onkeydown=\"if(event.key==='Enter')submitName()\">" +
          '<button class="btn btn-primary" onclick="submitName()">' + ic("check") + t("continueBtn") + "</button>" +
        "</div>" +
      "</div>";
    return;
  }

  if (currentView === "home") {
    content =
      '<div class="card home-card">' +
        dashboardHtml() +
        '<h2 class="home-title">' + t("appTitle") + "</h2>" +
        '<p class="home-user">' + t("loggedInAs") + " <strong id=\"user-display\">" + escapeHtml(currentUser) + "</strong></p>" +
        '<div class="home-buttons">' +
          '<button class="btn btn-primary btn-lg" onclick="navigate(\'inspection\')">' + ic("inspect") + t("startInspection") + "</button>" +
          '<button class="btn btn-info" onclick="navigate(\'historique\')">' + ic("history") + t("historique") + "</button>" +
          '<button class="btn btn-light" onclick="navigate(\'settings\')">' + ic("settings") + t("settings") + "</button>" +
        "</div>" +
      "</div>";

  } else if (currentView === "inspection") {
    if (zones.length === 0) {
      content =
        '<div class="card">' +
          emptyState(t("noZones"), t("navSettings"), "settings", "list") +
        "</div>";
    } else if (inspectionPicking || selectedZoneIds.length === 0) {
      // ---- Zone picker ----
      const list = zones.map(function (zone) {
        const checked = selectedZoneIds.indexOf(zone.zoneId) !== -1 ? " checked" : "";
        return (
          '<label class="zone-check">' +
            "<input type=\"checkbox\" value=\"" + escapeHtml(zone.zoneId) + "\"" + checked + ">" +
            '<span>' + escapeHtml(zone.zoneName) + "</span>" +
          "</label>"
        );
      }).join("");
      content =
        '<div class="card">' +
          '<div class="view-head">' +
            "<h2 class=\"view-title\">" + t("inspectionMode") + "</h2>" +
          "</div>" +
          '<p class="muted">' + t("chooseZones") + "</p>" +
          '<div class="zone-picker">' + list + "</div>" +
          '<div class="picker-actions">' +
            '<button class="btn btn-light btn-sm" onclick="selectAllZones()">' + t("selectAll") + "</button>" +
            '<button class="btn btn-light btn-sm" onclick="clearZoneSelection()">' + t("clearAll") + "</button>" +
          "</div>" +
          '<div class="picker-actions">' +
            '<button class="btn btn-primary" onclick="startInspectionFromPicker()">' + ic("inspect") + t("startInspection") + "</button>" +
            (inspectionPicking ? '<button class="btn btn-light" onclick="cancelZonePicking()">' + t("cancel") + "</button>" : "") +
          "</div>" +
        "</div>";
    } else {
      // ---- Active inspection (selected zones only) ----
      const body = selectedZones().map(function (zone) {
        const items = zone.items.length === 0
          ? '<p class="muted">' + t("noCriteria") + "</p>"
          : "<ul class=\"item-list\">" + zone.items.map(function (item) {
              const passStyle = item.status === "pass"
                ? "background:#2E7D32;color:#fff;"
                : "background:#E9EEF3;color:#44556B;";
              const noPassStyle = item.status === "no_pass"
                ? "background:#C0392B;color:#fff;"
                : "background:#E9EEF3;color:#44556B;";
              const ncStyle = item.status === "unchecked"
                ? "background:#94A3B8;color:#fff;"
                : "background:#E9EEF3;color:#44556B;";
              const meta = item.checkedAt
                ? '<div class="item-meta" id="meta-' + zone.zoneId + "-" + item.id + '">' + t("evaluatedBy") + " <strong>" + escapeHtml(item.checkedBy) + "</strong> " + t("on") + " " + escapeHtml(item.checkedAt) + "</div>"
                : '<div class="item-meta muted" id="meta-' + zone.zoneId + "-" + item.id + '">' + t("pending") + "</div>";
              const noteKey = zone.zoneId + ":" + item.id;
              const editing = editingNoteId === noteKey;
              const noteColor = noteColorOf(item);
              const colorChip = function (col, label) {
                return '<button class="note-color-chip ' + col + (noteColor === col ? " active" : "") + '" onclick="setNoteColor(\'' + zone.zoneId + "','" + item.id + "','" + col + "')\">" + label + "</button>";
              };
              const noteBlock = editing
                ? '<div class="note-editor">' +
                    '<textarea class="note-input" id="note-input-' + noteKey + '" placeholder="' + t("notePlaceholder") + '" oninput="setNote(\'' + zone.zoneId + "','" + item.id + "',this.value)\">" + escapeHtml(item.note || "") + "</textarea>" +
                    '<div class="note-color-picker">' +
                      colorChip("red", t("noteColorRed")) +
                      colorChip("green", t("noteColorGreen")) +
                    "</div>" +
                    '<button class="btn btn-primary btn-sm" onclick="saveNote()">' + ic("save") + t("save") + "</button>"
                : (item.note && item.note.trim()
                  ? '<div class="note-display note-' + noteColor + '">' +
                      '<button class="note-color-dot ' + noteColor + '" title="' + (noteColor === "red" ? t("noteColorGreen") : t("noteColorRed")) + '" onclick="setNoteColor(\'' + zone.zoneId + "','" + item.id + "','" + (noteColor === "red" ? "green" : "red") + "')\" aria-label=\"" + t("noteLabel") + "\"></button>" +
                      '<span class="note-text">' + escapeHtml(item.note) + '</span><button class="btn btn-light btn-sm" onclick="editNote(\'' + zone.zoneId + "','" + item.id + "')\">" + ic("pencil") + t("edit") + "</button>" +
                    "</div>"
                  : '<button class="btn btn-light btn-sm" onclick="editNote(\'' + zone.zoneId + "','" + item.id + "')\">" + ic("note") + t("addNote") + "</button>");
              return (
                '<li class="item-row" id="row-' + zone.zoneId + "-" + item.id + '">' +
                  '<div class="item-text">' + escapeHtml(item.text) + "</div>" +
                  tagBadgesHtml(item.tags) +
                  '<div class="item-actions">' +
                    "<button class=\"status-btn\" data-st=\"pass\" style=\"" + passStyle + "\" onclick=\"setStatus('" + zone.zoneId + "','" + item.id + "','pass')\">" + ic("check") + t("pass") + "</button>" +
                    "<button class=\"status-btn\" data-st=\"no_pass\" style=\"" + noPassStyle + "\" onclick=\"setStatus('" + zone.zoneId + "','" + item.id + "','no_pass')\">" + ic("x") + t("noPass") + "</button>" +
                    "<button class=\"status-btn\" data-st=\"unchecked\" style=\"" + ncStyle + "\" onclick=\"setStatus('" + zone.zoneId + "','" + item.id + "','unchecked')\">" + ic("minus") + t("notChecked") + "</button>" +
                  "</div>" +
                  noteBlock +
                  photosHtml(zone.zoneId, item.id, item.photos) +
                  '<button class="photo-add-btn" onclick="capturePhoto(\'' + zone.zoneId + '\',\'' + item.id + "')\">" + ic("note") + " " + t("addPhoto") + "</button>" +
                  meta +
                "</li>"
              );
            }).join("") + "</ul>";
        return (
          '<div class="zone-card">' +
            '<div class="zone-head">' +
              '<h3 class="zone-title">' + escapeHtml(zone.zoneName) + "</h3>" +
              zoneProgressLabel(zone) +
            "</div>" +
            items +
          "</div>"
        );
      }).join("");
      const finishActions =
        '<div class="finish-actions">' +
          '<button class="btn btn-light" onclick="changeZones()">' + ic("list") + t("changeZones") + "</button>" +
          '<button class="btn btn-light" onclick="saveProgress()">' + ic("save") + t("saveProgress") + "</button>" +
          '<button class="btn btn-primary" onclick="showReview()">' + ic("flag") + t("finishInspection") + "</button>" +
          '<button class="btn btn-info" onclick="exportInspectionPDF()">' + ic("download") + t("exportPDF") + "</button>" +
        "</div>";
      content =
        '<div class="card">' +
          '<div class="view-head">' +
            "<h2 class=\"view-title\">" + t("inspectionMode") + "</h2>" +
          "</div>" +
          progressHtml() +
          body +
          finishActions +
        "</div>";
    }

  } else if (currentView === "historique") {
    var hToggle = '<div class="tab-toggle">' +
      '<button class="tab-toggle-btn' + (historySubView === "sessions" ? " active" : "") + '" onclick="historySubView=\'sessions\';render()">' + t("tabSessions") + '</button>' +
      '<button class="tab-toggle-btn' + (historySubView === "ncs" ? " active" : "") + '" onclick="historySubView=\'ncs\';render()">' + t("tabNCs") + ' (' + ncs.length + ')</button>' +
    '</div>';
    let body;
    if (historySubView === "ncs") {
      body = ncListViewHtml();
    } else if (!sessions.length) {
      body = emptyState(t("noSessions"), null, null, "history");
    } else {
      const sorted = sessions.slice().sort(function (a, b) {
        return (b.finishedAt || "").localeCompare(a.finishedAt || "");
      });
      body = '<div class="session-list">' + sorted.map(function (s) {
        const logs = s.items || [];
        const id = "report-container-" + s.id;
        return (
          '<div class="session-card">' +
            '<div class="session-head">' +
              '<div class="session-meta">' +
                '<div class="session-date">' + t("finishedOn") + " " + escapeHtml(formatDateTime(s.finishedAt)) + "</div>" +
                '<div class="session-inspector">' + t("inspectorLabel") + ": <strong>" + escapeHtml(s.inspector || "") + "</strong></div>" +
                '<div class="session-status">' + statusPill(s.status) + '</div>' +
              "</div>" +
              summaryHtml(logs) +
            "</div>" +
            '<div class="session-actions">' +
              '<button class="btn btn-light btn-sm" onclick="toggleReport(\'' + id + '\', this)">' + ic("eye") + t("viewReport") + "</button>" +
              '<button class="btn btn-primary btn-sm" onclick="exportSessionPDF(\'' + s.id + '\')">' + ic("download") + t("exportPDF") + "</button>" +
              '<button class="btn btn-danger btn-sm" onclick="deleteSession(\'' + s.id + '\')">' + ic("trash") + t("delete") + "</button>" +
            "</div>" +
            '<div id="' + id + '" class="report-container collapsed">' +
              buildReportHtml(logs, { title: t("reportTitle"), dateLabel: t("finishedOn"), date: formatDateTime(s.finishedAt) }) +
            "</div>" +
          "</div>"
        );
      }).join("") + "</div>";
    }

    content =
      '<div class="card">' +
        '<div class="view-head">' +
          "<h2 class=\"view-title\">" + t("historyTitle") + "</h2>" +
          (historySubView === "sessions" && sessions.length ? '<button class="btn btn-danger btn-sm" onclick="clearHistory()">' + ic("trash") + t("clearHistory") + "</button>" : "") +
        "</div>" +
        hToggle +
        body +
      "</div>";

  } else if (currentView === "analytics") {
    var aToggle = '<div class="tab-toggle">' +
      '<button class="tab-toggle-btn' + (analyticsSubView === "inspections" ? " active" : "") + '" onclick="analyticsSubView=\'inspections\';render()">' + t("analyticsInspections") + '</button>' +
      '<button class="tab-toggle-btn' + (analyticsSubView === "ncs" ? " active" : "") + '" onclick="analyticsSubView=\'ncs\';render()">' + t("analyticsNCs") + '</button>' +
    '</div>';
    var aContent = analyticsSubView === "ncs" ? ncAnalyticsHtml() : analyticsViewHtml();
    content =
      '<div class="card">' +
        '<div class="view-head">' +
          "<h2 class=\"view-title\">" + t("analyticsTitle") + "</h2>" +
          (sessions.length ? '<button class="btn btn-primary btn-sm" onclick="exportAnalyticsPdf()">' + ic("download") + t("exportPDF") + "</button>" : "") +
        "</div>" +
        aToggle +
        aContent +
      "</div>";

  } else if (currentView === "settings") {
    const zoneCards = zones.length === 0
      ? emptyState(t("noZonesConfig"), null, null, "settings")
      : zones.map(function (zone) {
          let header;
          if (editingZoneId === zone.zoneId) {
            header =
              "<input id=\"edit-zone-input\" class=\"text-input\" type=\"text\" value=\"" + escapeHtml(zone.zoneName) + "\">" +
              "<button class=\"btn btn-primary btn-sm\" onclick=\"saveZoneName('" + zone.zoneId + "')\">" + ic("save") + t("save") + "</button>" +
              "<button class=\"btn btn-light btn-sm\" onclick=\"cancelEdit()\">" + t("cancel") + "</button>";
          } else {
            header =
              "<h3 class=\"zone-title\">" + escapeHtml(zone.zoneName) + "</h3>" +
              "<div class=\"zone-tools\">" +
                "<button class=\"btn btn-light btn-sm\" onclick=\"startRenameZone('" + zone.zoneId + "')\">" + ic("pencil") + t("rename") + "</button>" +
                "<button class=\"btn btn-danger btn-sm\" onclick=\"deleteZone('" + zone.zoneId + "')\">" + ic("trash") + t("deleteZone") + "</button>" +
              "</div>";
          }

          const items = zone.items.length === 0
            ? '<p class="muted">' + t("noCriteria") + "</p>"
            : "<ul class=\"item-list\">" + zone.items.map(function (item) {
                if (editingItemId === item.id) {
                  return (
                    '<li class="item-row edit-row">' +
                      "<input id=\"edit-item-input\" class=\"text-input\" type=\"text\" value=\"" + escapeHtml(item.text) + "\">" +
                      "<button class=\"btn btn-primary btn-sm\" onclick=\"saveItemText('" + zone.zoneId + "','" + item.id + "')\">" + ic("save") + t("save") + "</button>" +
                      "<button class=\"btn btn-light btn-sm\" onclick=\"cancelEdit()\">" + t("cancel") + "</button>" +
                    "</li>"
                  );
                }
                  return (
                '<li class="item-row">' +
                  '<span class="item-text">' + escapeHtml(item.text) + "</span>" +
                  '<span class="item-tools">' +
                    "<button class=\"btn btn-light btn-sm\" onclick=\"startEditItem('" + zone.zoneId + "','" + item.id + "')\">" + ic("pencil") + t("edit") + "</button>" +
                    "<button class=\"btn btn-danger btn-sm\" onclick=\"deleteItem('" + zone.zoneId + "','" + item.id + "')\">" + ic("trash") + t("remove") + "</button>" +
                  "</span>" +
                  (item.note && item.note.trim()
                    ? '<div class="note-display"><span class="note-text">' + escapeHtml(item.note) + "</span></div>"
                    : "") +
                  (item.tags && item.tags.length
                    ? '<div class="tag-badges tag-badges-settings">' + item.tags.map(function (tag, ti) {
                        return '<span class="tag-badge" style="background:' + escapeHtml(tag.color) + '">' + escapeHtml(tag.name) +
                          '<button class="tag-badge-x" onclick="removeTagFromItem(\'' + zone.zoneId + "','" + item.id + "'," + ti + ")\">&times;</button></span>";
                      }).join("") + "</div>"
                    : "") +
                  '<div class="tag-add-row">' +
                    '<input id="tag-name-' + item.id + '" class="text-input tag-name-input" type="text" placeholder="' + t("tagName") + '">' +
                    '<div class="tag-color-picker" data-item="' + item.id + '">' +
                      TAG_COLORS.map(function (c) {
                        return '<button class="tag-color-btn' + (c === TAG_COLORS[0] ? " active" : "") + '" data-color="' + c + '" style="background:' + c + '" onclick="selectTagColor(\'' + item.id + "','" + c + "')\"></button>";
                      }).join("") +
                    '</div>' +
                    '<button class="btn btn-light btn-sm" onclick="addTagToItem(\'' + zone.zoneId + "','" + item.id + "')\">" + ic("plus") + t("addTag") + "</button>" +
                  "</div>" +
                "</li>"
              );
              }).join("") + "</ul>";

          return (
            '<div class="zone-card">' +
              '<div class="zone-header">' + header + "</div>" +
              '<div class="add-item-row">' +
                "<input id=\"setting-input-" + zone.zoneId + "\" class=\"text-input\" type=\"text\" placeholder=\"" + t("newCriterion") + "\">" +
                "<button class=\"btn btn-light\" onclick=\"addItem('" + zone.zoneId + "')\">" + ic("plus") + t("addCriterion") + "</button>" +
              "</div>" +
              items +
            "</div>"
          );
        }).join("");

    content =
      '<div class="card">' +
        '<div class="view-head">' +
          "<h2 class=\"view-title\">" + t("settingsTitle") + "</h2>" +
        "</div>" +
        '<div class="add-zone-row">' +
          "<input id=\"new-zone-input\" class=\"text-input\" type=\"text\" placeholder=\"" + t("newZoneName") + "\">" +
          "<button class=\"btn btn-primary\" onclick=\"addZoneFromInput()\">" + ic("plus") + t("addZone") + "</button>" +
        "</div>" +
        '<div class="data-section">' +
          "<h3 class=\"data-title\">" + t("changeName") + "</h3>" +
          '<div class="add-zone-row">' +
            "<input id=\"settings-user-input\" class=\"text-input\" type=\"text\" value=\"" + escapeHtml(currentUser) + "\">" +
            '<button class="btn btn-primary" onclick="saveSettingsName()">' + ic("save") + t("save") + "</button>" +
          "</div>" +
        "</div>" +
        '<div class="data-section">' +
          "<h3 class=\"data-title\">" + t("passThreshold") + "</h3>" +
          "<p class=\"muted\">" + t("analysisTitle") + ". " + t("thresholdLabel") + "</p>" +
          '<div class="add-zone-row">' +
            "<input id=\"settings-threshold-input\" class=\"text-input\" type=\"number\" min=\"0\" max=\"100\" step=\"1\" value=\"" + passThreshold + "\">" +
            '<button class="btn btn-primary" onclick="saveThreshold()">' + ic("save") + t("save") + "</button>" +
          "</div>" +
        "</div>" +
        zoneCards +
        ncSettingsHtml() +
        globalTagManagerHtml() +
        '<div class="data-section">' +
          "<h3 class=\"data-title\">" + t("dataManagement") + "</h3>" +
          '<p class="muted">' + t("dataHelp") + "</p>" +
          dbSectionHtml() +
          '<div class="data-actions">' +
            "<button class=\"btn btn-light\" onclick=\"exportFile()\">" + ic("download") + t("exportBtn") + "</button>" +
            "<label class=\"btn btn-light\" for=\"import-input\">" + ic("upload") + t("importBtn") + "</label>" +
            "<input id=\"import-input\" type=\"file\" accept=\"application/json,.json\" style=\"display:none\" onchange=\"importFile(this)\">" +
          "</div>" +
        "</div>" +
      "</div>";
  } else if (currentView === "review") {
    content =
      '<div class="card">' +
        '<div class="view-head">' +
          "<h2 class=\"view-title\">" + t("reviewTitle") + "</h2>" +
        "</div>" +
        reviewHtml() +
      "</div>";

  } else if (currentView === "ncDetail") {
    content =
      '<div class="card">' +
        '<div class="view-head">' +
          "<h2 class=\"view-title\">" + t("ncDetail") + "</h2>" +
        "</div>" +
        ncDetailViewHtml() +
      "</div>";

  }

  app.innerHTML = shell(content);
}

// ==== TAB 1: DASHBOARD ====
function totalItemsCount() {
  var count = 0;
  zones.forEach(function (z) { count += z.items.length; });
  return count;
}

function lastSessionStats() {
  if (!sessions.length) return null;
  var sorted = sessions.slice().sort(function (a, b) { return (b.finishedAt || "").localeCompare(a.finishedAt || ""); });
  var last = sorted[0];
  var pass = 0, fail = 0, unchecked = 0;
  (last.items || []).forEach(function (i) {
    if (i.status === "pass") pass++;
    else if (i.status === "no_pass") fail++;
    else unchecked++;
  });
  var total = pass + fail + unchecked;
  var rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  return { session: last, pass: pass, fail: fail, unchecked: unchecked, total: total, rate: rate };
}

function dashboardHtml() {
  var stats = lastSessionStats();
  var zCount = zones.length;
  var cCount = totalItemsCount();
  var h = '<div class="dashboard-cards">' +
    '<div class="stat-card"><div class="stat-icon">' + ic("list") + '</div><div class="stat-value">' + zCount + '</div><div class="stat-label">' + t("dashZones") + '</div></div>' +
    '<div class="stat-card"><div class="stat-icon">' + ic("inspect") + '</div><div class="stat-value">' + cCount + '</div><div class="stat-label">' + t("dashCriteria") + '</div></div>' +
    '<div class="stat-card"><div class="stat-icon" style="color:#2E7D32">&#10003;</div><div class="stat-value" style="color:#2E7D32">' + (stats ? stats.pass : "—") + '</div><div class="stat-label">' + t("dashPassed") + '</div></div>' +
    '<div class="stat-card"><div class="stat-icon" style="color:#C03025">&#10007;</div><div class="stat-value" style="color:#C03025">' + (stats ? stats.fail : "—") + '</div><div class="stat-label">' + t("dashFailed") + '</div></div>' +
  '</div>';
  if (stats) {
    var rateColor = stats.rate >= passThreshold ? "#2E7D32" : "#C03025";
    h += '<div class="last-inspection-bar">' +
      '<div class="li-header">' +
        '<span class="li-title">' + t("dashLastInspection") + '</span>' +
        '<span class="li-meta">' + escapeHtml(stats.session.inspector || "") + ' &middot; ' + escapeHtml(formatDateTime(stats.session.finishedAt)) + '</span>' +
      '</div>' +
      '<div class="li-rate">' +
        '<div class="li-rate-bar"><div class="li-rate-fill ' + (stats.rate >= passThreshold ? "good" : "bad") + '" style="width:' + stats.rate + '%"></div></div>' +
        '<span class="li-rate-text" style="color:' + rateColor + '">' + stats.rate + '%</span>' +
      '</div>' +
    '</div>';
  } else {
    h += '<div class="last-inspection-bar"><div class="li-meta">' + t("dashNoData") + '</div></div>';
  }
  return h;
}

// ==== TAB 2: PHOTOS ====
function capturePhoto(zoneId, itemId) {
  var input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";
  input.onchange = function () {
    var file = input.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast(t("photoTooLarge")); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var canvas = document.createElement("canvas");
        var maxSize = 800;
        var w = img.width, h = img.height;
        if (w > maxSize || h > maxSize) {
          if (w > h) { h = Math.round(h * maxSize / w); w = maxSize; }
          else { w = Math.round(w * maxSize / h); h = maxSize; }
        }
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        var dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        var photoId = "photo-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
        Storage.savePhoto(photoId, dataUrl).then(function () {
          var zone = zones.find(function (z) { return z.zoneId === zoneId; });
          if (zone) {
            var item = zone.items.find(function (it) { return it.id === itemId; });
            if (item) {
              if (!item.photos) item.photos = [];
              item.photos.push(photoId);
              persist();
              render();
              showToast(t("photoAdded"));
            }
          }
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function deletePhoto(zoneId, itemId, photoId) {
  var zone = zones.find(function (z) { return z.zoneId === zoneId; });
  if (!zone) return;
  var item = zone.items.find(function (it) { return it.id === itemId; });
  if (!item || !item.photos) return;
  item.photos = item.photos.filter(function (p) { return p !== photoId; });
  Storage.deletePhoto(photoId);
  persist();
  render();
  showToast(t("photoDeleted"));
}

async function viewPhoto(photoId) {
  var data = await Storage.getPhoto(photoId);
  if (!data) return;
  viewingPhotoData = data;
  var overlay = document.createElement("div");
  overlay.className = "photo-viewer-overlay";
  overlay.onclick = function () { overlay.remove(); viewingPhotoData = null; };
  overlay.innerHTML = '<button class="photo-viewer-close">&times;</button><img src="' + data + '" alt="Photo">';
  document.body.appendChild(overlay);
}

function photosHtml(zoneId, itemId, photos) {
  if (!photos || !photos.length) return "";
  var h = '<div class="photo-thumbs">';
  photos.forEach(function (pid) {
    h += '<div class="photo-thumb" onclick="Storage.getPhoto(\'' + pid + '\').then(function(d){if(d){var o=document.createElement(\'div\');o.className=\'photo-viewer-overlay\';o.onclick=function(){o.remove()};o.innerHTML=\'<button class=photo-viewer-close>&times;</button><img src=\'+d+\' alt=Photo>\';document.body.appendChild(o)}})"">' +
      '<img src="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'/%3E" alt="">' +
      '<button class="photo-thumb-x" onclick="event.stopPropagation();deletePhoto(\'' + zoneId + '\',\'' + itemId + '\',\'' + pid + '\')">&times;</button>' +
    '</div>';
  });
  h += '</div>';
  return h;
}

// ==== TAB 2: REVIEW SCREEN ====
function showReview() {
  currentView = "review";
  render();
}

function reviewHtml() {
  var pass = 0, fail = 0, unchecked = 0;
  selectedZones().forEach(function (z) {
    z.items.forEach(function (i) {
      if (i.status === "pass") pass++;
      else if (i.status === "no_pass") fail++;
      else unchecked++;
    });
  });
  var total = pass + fail + unchecked;
  var rate = total > 0 ? Math.round((pass / total) * 100) : 0;
  var rateColor = rate >= passThreshold ? "#2E7D32" : "#C03025";
  var zonesList = selectedZones().map(function (z) { return escapeHtml(z.zoneName); }).join(", ");

  return '<div class="review-card">' +
    '<h3>' + t("reviewTitle") + '</h3>' +
    '<div class="review-stats">' +
      '<div class="review-stat pass"><div class="rs-value">' + pass + '</div><div class="rs-label">' + t("dashPassed") + '</div></div>' +
      '<div class="review-stat fail"><div class="rs-value">' + fail + '</div><div class="rs-label">' + t("dashFailed") + '</div></div>' +
      '<div class="review-stat unchecked"><div class="rs-value">' + unchecked + '</div><div class="rs-label">' + t("reviewUnchecked") + '</div></div>' +
    '</div>' +
    '<div class="review-rate">' +
      '<span style="font-size:13px;font-weight:600;color:#44556B">' + t("dashPassRate") + '</span>' +
      '<div class="review-rate-bar"><div class="review-rate-fill" style="width:' + rate + '%;background:' + rateColor + '"></div></div>' +
      '<span class="review-rate-text" style="color:' + rateColor + '">' + rate + '%</span>' +
    '</div>' +
    '<div class="review-meta"><strong>' + t("reviewZones") + ':</strong> ' + zonesList + '</div>' +
    '<div class="review-actions">' +
      '<button class="btn btn-primary" onclick="finishInspection()">' + ic("flag") + t("finishInspection") + '</button>' +
      '<button class="btn btn-light" onclick="navigate(\'inspection\')">' + ic("list") + t("reviewBack") + '</button>' +
    '</div>' +
  '</div>';
}

// ==== NON-CONFORMITIES ====
var ncIdCounter = 0;

function nextNcId() {
  var max = 0;
  ncs.forEach(function (nc) {
    var num = parseInt(nc.id.replace("NC-", ""), 10);
    if (num > max) max = num;
  });
  return "NC-" + String(max + 1).padStart(3, "0");
}

function checkRecurrent(itemText, zoneName, sessionId) {
  var threshold = ncSettings.recurrentThreshold || 3;
  var recentSessions = sessions.slice().sort(function (a, b) {
    return (b.finishedAt || "").localeCompare(a.finishedAt || "");
  }).slice(0, threshold);
  if (recentSessions.length < threshold) return { recurrent: false, dates: [] };
  var failDates = [];
  for (var i = 0; i < recentSessions.length; i++) {
    var s = recentSessions[i];
    var failed = (s.items || []).some(function (it) {
      return it.text === itemText && it.zoneName === zoneName && it.status === "no_pass";
    });
    if (!failed) return { recurrent: false, dates: [] };
    failDates.push((s.finishedAt || "").slice(0, 10));
  }
  return { recurrent: true, dates: failDates };
}

function createNcsFromSession(session) {
  var created = [];
  (session.items || []).forEach(function (item) {
    if (item.status !== "no_pass") return;
    var rec = checkRecurrent(item.text, item.zoneName, session.id);
    var nc = {
      id: nextNcId(),
      sessionId: session.id,
      zoneName: item.zoneName,
      itemText: item.text,
      description: item.text,
      status: "open",
      recurrent: rec.recurrent,
      recurrentDates: rec.dates,
      createdAt: (session.finishedAt || "").slice(0, 10),
      correctiveAction: ncSettings.defaultCorrectiveAction || "",
      responsible: "",
      deadline: "",
      note: item.note || "",
      photos: item.photos || []
    };
    ncs.push(nc);
    created.push(nc);
  });
  if (ncSettings.autoCloseNCs) {
    ncs.forEach(function (nc) {
      if (nc.status === "closed") return;
      var match = (session.items || []).some(function (it) {
        return it.text === nc.itemText && it.zoneName === nc.zoneName && it.status === "pass";
      });
      if (match) { nc.status = "closed"; }
    });
  }
  if (created.length) persist();
  return created;
}

function ncListViewHtml() {
  if (!ncs.length) return '<div class="empty-state"><p>' + t("noNCs") + '</p></div>';
  var sorted = ncs.slice().sort(function (a, b) {
    if (a.status === "open" && b.status !== "open") return -1;
    if (a.status !== "open" && b.status === "open") return 1;
    return (b.createdAt || "").localeCompare(a.createdAt || "");
  });
  var h = '<input type="text" class="text-input" placeholder="Search NCs..." id="nc-search" oninput="filterNCs()" style="width:100%;margin-bottom:12px">';
  h += '<div id="nc-list-container">';
  sorted.forEach(function (nc) {
    h += ncCardHtml(nc);
  });
  h += '</div>';
  return h;
}

function ncCardHtml(nc) {
  var badgeClass = nc.status;
  if (nc.status === "open" && nc.deadline && nc.deadline < new Date().toISOString().slice(0, 10)) badgeClass = "overdue";
  var badges = '<span class="nc-badge ' + badgeClass + '">' + t("nc" + nc.status.charAt(0).toUpperCase() + nc.status.slice(1)) + '</span>';
  if (nc.recurrent) badges += '<span class="nc-badge recurrent">' + t("ncRecurrent") + '</span>';
  return '<div class="nc-card" onclick="viewNcDetail(\'' + nc.id + '\')">' +
    '<div class="nc-info">' +
      '<div class="nc-title">' + escapeHtml(nc.id) + ': ' + escapeHtml(nc.description) + '</div>' +
      '<div class="nc-meta">' + escapeHtml(nc.zoneName) + ' &middot; ' + escapeHtml(nc.createdAt) + '</div>' +
    '</div>' +
    '<div class="nc-actions">' + badges + '</div>' +
  '</div>';
}

function filterNCs() {
  var query = (document.getElementById("nc-search") || {}).value || "";
  query = query.toLowerCase();
  var container = document.getElementById("nc-list-container");
  if (!container) return;
  var html = "";
  ncs.forEach(function (nc) {
    var match = !query ||
      nc.id.toLowerCase().indexOf(query) !== -1 ||
      nc.description.toLowerCase().indexOf(query) !== -1 ||
      nc.zoneName.toLowerCase().indexOf(query) !== -1;
    if (match) html += ncCardHtml(nc);
  });
  container.innerHTML = html || '<p class="muted">' + t("noNCs") + '</p>';
}

function viewNcDetail(ncId) {
  viewingNcId = ncId;
  currentView = "ncDetail";
  render();
}

function ncDetailViewHtml() {
  var nc = ncs.find(function (n) { return n.id === viewingNcId; });
  if (!nc) return '<p class="muted">' + t("ncNotFound") + '</p>';
  var h = '<div class="nc-detail">' +
    '<button class="btn btn-light btn-sm" style="margin-bottom:12px" onclick="historySubView=\'ncs\';navigate(\'historique\')">&larr; ' + t("ncTitle") + '</button>' +
    '<div class="nc-detail-header">' +
      '<div class="ncd-title">' + escapeHtml(nc.id) + '</div>' +
      '<div class="ncd-meta">' + escapeHtml(nc.zoneName) + ' &middot; ' + escapeHtml(nc.createdAt) + '</div>' +
    '</div>';
  if (nc.recurrent) {
    h += '<div class="nc-recurrent-banner">' +
      '<div class="ncr-title">' + t("ncRecurrent") + '</div>' +
      '<div class="ncr-dates">' + t("ncRecurrentDesc") + ': ' + nc.recurrentDates.join(", ") + '</div>' +
    '</div>';
  }
  h += '<div class="nc-form-group"><label>' + t("ncStatus") + '</label>' +
    '<select id="nc-status-select" class="nc-status-select">' +
      '<option value="open"' + (nc.status === "open" ? " selected" : "") + '>' + t("ncOpen") + '</option>' +
      '<option value="in_progress"' + (nc.status === "in_progress" ? " selected" : "") + '>' + t("ncInProgress") + '</option>' +
      '<option value="closed"' + (nc.status === "closed" ? " selected" : "") + '>' + t("ncClosed") + '</option>' +
    '</select></div>';
  h += '<div class="nc-form-group"><label>' + t("ncCorrective") + '</label>' +
    '<textarea id="nc-corrective" rows="3">' + escapeHtml(nc.correctiveAction) + '</textarea></div>';
  h += '<div class="nc-form-group"><label>' + t("ncResponsible") + '</label>' +
    '<input type="text" id="nc-responsible" value="' + escapeHtml(nc.responsible) + '"></div>';
  h += '<div class="nc-form-group"><label>' + t("ncDeadline") + '</label>' +
    '<input type="date" id="nc-deadline" value="' + escapeHtml(nc.deadline) + '"></div>';
  h += '<div class="nc-form-group"><label>' + t("noteLabel") + '</label>' +
    '<textarea id="nc-note" rows="2">' + escapeHtml(nc.note) + '</textarea></div>';
  h += '<button class="btn btn-primary" onclick="saveNcDetail()">' + t("ncSave") + '</button>';
  h += '</div>';
  return h;
}

function saveNcDetail() {
  var nc = ncs.find(function (n) { return n.id === viewingNcId; });
  if (!nc) return;
  nc.status = document.getElementById("nc-status-select").value;
  nc.correctiveAction = document.getElementById("nc-corrective").value;
  nc.responsible = document.getElementById("nc-responsible").value;
  nc.deadline = document.getElementById("nc-deadline").value;
  nc.note = document.getElementById("nc-note").value;
  persist();
  showToast(t("ncSaved"));
}

// ==== TAB 4: NC ANALYTICS + DONUTS ====
function ncAnalyticsHtml() {
  var totalNcs = ncs.length;
  var closed = ncs.filter(function (nc) { return nc.status === "closed"; }).length;
  var inProgress = ncs.filter(function (nc) { return nc.status === "in_progress"; }).length;
  var open = ncs.filter(function (nc) { return nc.status === "open"; }).length;
  var today = new Date().toISOString().slice(0, 10);
  var overdue = ncs.filter(function (nc) { return nc.status !== "closed" && nc.deadline && nc.deadline < today; }).length;
  var recurrent = ncs.filter(function (nc) { return nc.recurrent; }).length;
  var closedRate = totalNcs > 0 ? Math.round((closed / totalNcs) * 100) : 0;

  var h = '<div class="dashboard-cards">' +
    '<div class="stat-card"><div class="stat-value">' + totalNcs + '</div><div class="stat-label">' + t("ncTotal") + '</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#2E7D32">' + closedRate + '%</div><div class="stat-label">' + t("ncClosedRate") + '</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#C03925">' + recurrent + '</div><div class="stat-label">' + t("ncRecurrentCount") + '</div></div>' +
    '<div class="stat-card"><div class="stat-value" style="color:#E65100">' + overdue + '</div><div class="stat-label">' + t("ncOverdueCount") + '</div></div>' +
  '</div>';

  h += '<div class="nc-status-list">' +
    '<div class="nc-status-item"><div class="nc-status-dot closed"></div>' + t("ncStatusClosed") + ': ' + closed + '</div>' +
    '<div class="nc-status-item"><div class="nc-status-dot in_progress"></div>' + t("ncStatusInProgress") + ': ' + inProgress + '</div>' +
    '<div class="nc-status-item"><div class="nc-status-dot open"></div>' + t("ncStatusOpen") + ': ' + open + '</div>' +
    '<div class="nc-status-item"><div class="nc-status-dot overdue"></div>' + t("ncStatusOverdue") + ': ' + overdue + '</div>' +
  '</div>';

  h += tagDonutsHtml();
  return h;
}

function computeTagStats() {
  var tagMap = {};
  sessions.forEach(function (s) {
    (s.items || []).forEach(function (item) {
      var tags = item.tags || [];
      if (item.tagIds && zones.length) {
        zones.forEach(function (z) {
          z.items.forEach(function (zi) {
            if (zi.text === item.text && zi.tagIds) {
              zi.tagIds.forEach(function (tid) {
                var zone = zones.find(function (zz) { return zz.zoneId === z.zoneId; });
                if (zone) {
                  var tObj = (zone.tags || []).find(function (tt) { return tt.id === tid; });
                  if (tObj) tags.push(tObj);
                }
              });
            }
          });
        });
      }
      tags.forEach(function (tag) {
        var key = tag.name;
        if (!tagMap[key]) tagMap[key] = { name: tag.name, color: tag.color || "#666", pass: 0, noPass: 0, unchecked: 0 };
        if (item.status === "pass") tagMap[key].pass++;
        else if (item.status === "no_pass") tagMap[key].noPass++;
        else tagMap[key].unchecked++;
      });
    });
  });
  zones.forEach(function (z) {
    z.items.forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        var key = tag.name;
        if (!tagMap[key]) tagMap[key] = { name: tag.name, color: tag.color || "#666", pass: 0, noPass: 0, unchecked: 0 };
      });
    });
  });
  return tagMap;
}

function renderDonutSvg(pass, noPass, unchecked) {
  var total = pass + noPass + unchecked;
  if (total === 0) total = 1;
  var R = 35, C = 2 * Math.PI * R;
  var pLen = (pass / total) * C;
  var fLen = (noPass / total) * C;
  var uLen = (unchecked / total) * C;
  var offset = 0;
  var passPct = Math.round((pass / (pass + noPass || 1)) * 100);

  var svg = '<svg viewBox="0 0 100 100" width="80" height="80">';
  if (pass > 0) { svg += '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="#2E7D32" stroke-width="10" stroke-dasharray="' + pLen + ' ' + (C - pLen) + '" stroke-dashoffset="' + (-offset) + '"/>'; offset += pLen; }
  if (noPass > 0) { svg += '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="#C0392B" stroke-width="10" stroke-dasharray="' + fLen + ' ' + (C - fLen) + '" stroke-dashoffset="' + (-offset) + '"/>'; offset += fLen; }
  if (unchecked > 0) { svg += '<circle cx="50" cy="50" r="' + R + '" fill="none" stroke="#E0E4EA" stroke-width="10" stroke-dasharray="' + uLen + ' ' + (C - uLen) + '" stroke-dashoffset="' + (-offset) + '"/>'; }
  svg += '<text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="14" font-weight="bold" fill="#333">' + passPct + '%</text>';
  svg += '</svg>';
  return svg;
}

function tagDonutsHtml() {
  var tagStats = computeTagStats();
  var keys = Object.keys(tagStats);
  if (!keys.length) return '<p class="muted">' + t("donutNoTags") + '</p>';
  var h = '<h3 style="margin:16px 0 12px;font-size:14px;font-weight:700;color:#44556B">' + t("donutByTag") + '</h3><div class="donut-grid">';
  keys.forEach(function (k) {
    var ts = tagStats[k];
    h += '<div class="donut-card">' +
      renderDonutSvg(ts.pass, ts.noPass, ts.unchecked) +
      '<div class="donut-title"><div class="donut-title-dot" style="background:' + escapeHtml(ts.color) + '"></div>' + escapeHtml(ts.name) + '</div>' +
      '<div class="donut-legend">' +
        '<span class="donut-legend-item"><div class="donut-legend-dot" style="background:#2E7D32"></div>' + ts.pass + '</span>' +
        '<span class="donut-legend-item"><div class="donut-legend-dot" style="background:#C0392B"></div>' + ts.noPass + '</span>' +
        '<span class="donut-legend-item"><div class="donut-legend-dot" style="background:#E0E4EA"></div>' + ts.unchecked + '</span>' +
      '</div>' +
    '</div>';
  });
  h += '</div>';
  return h;
}

// ==== TAB 5: NC SETTINGS + GLOBAL TAG MANAGER ====
function saveNcSettings() {
  ncSettings.overdueDays = parseInt(document.getElementById("nc-overdue-days").value, 10) || 7;
  ncSettings.recurrentThreshold = parseInt(document.getElementById("nc-recurrent-threshold").value, 10) || 3;
  ncSettings.defaultCorrectiveAction = document.getElementById("nc-default-corrective").value;
  ncSettings.autoCloseNCs = document.getElementById("nc-auto-close").checked;
  persist();
  showToast(t("ncSettingsSaved"));
}

function ncSettingsHtml() {
  return '<div class="nc-settings-section">' +
    '<h3>' + t("ncSettingsTitle") + '</h3>' +
    '<div class="nc-setting-row"><label>' + t("overdueDays") + '</label>' +
      '<input type="number" id="nc-overdue-days" class="text-input" min="1" max="365" value="' + (ncSettings.overdueDays || 7) + '">' +
      '<div class="nc-help">' + t("overdueDaysHelp") + '</div></div>' +
    '<div class="nc-setting-row"><label>' + t("recurrentThreshold") + '</label>' +
      '<input type="number" id="nc-recurrent-threshold" class="text-input" min="2" max="20" value="' + (ncSettings.recurrentThreshold || 3) + '">' +
      '<div class="nc-help">' + t("recurrentThresholdHelp") + '</div></div>' +
    '<div class="nc-setting-row"><label>' + t("defaultCorrective") + '</label>' +
      '<textarea id="nc-default-corrective" class="text-input" rows="2">' + escapeHtml(ncSettings.defaultCorrectiveAction || "") + '</textarea>' +
      '<div class="nc-help">' + t("defaultCorrectiveHelp") + '</div></div>' +
    '<div class="nc-setting-row"><label class="nc-toggle">' +
      '<input type="checkbox" id="nc-auto-close"' + (ncSettings.autoCloseNCs ? " checked" : "") + '> ' + t("autoCloseNCs") + '</label>' +
      '<div class="nc-help">' + t("autoCloseNCsHelp") + '</div></div>' +
    '<button class="btn btn-primary btn-sm" onclick="saveNcSettings()">' + ic("save") + t("ncSave") + '</button>' +
  '</div>';
}

function getAllTagsGlobal() {
  var tagMap = {};
  zones.forEach(function (z) {
    z.items.forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        var key = tag.name;
        if (!tagMap[key]) tagMap[key] = { name: tag.name, color: tag.color || "#666", count: 0 };
        tagMap[key].count++;
      });
    });
  });
  return Object.values(tagMap);
}

function globalTagManagerHtml() {
  var tags = getAllTagsGlobal();
  var h = '<div class="data-section"><h3 class="data-title">' + t("globalTagsTitle") + '</h3>';
  if (!tags.length) {
    h += '<p class="muted">' + t("globalTagNoTags") + '</p>';
  } else {
    h += '<div class="global-tag-list">';
    tags.forEach(function (tag) {
      h += '<div class="global-tag-row">' +
        '<div class="gtr-color" style="background:' + escapeHtml(tag.color) + '"></div>' +
        '<span class="gtr-name">' + escapeHtml(tag.name) + '</span>' +
        '<span class="gtr-count">' + tag.count + ' ' + t("globalTagItems") + '</span>' +
        '<div class="gtr-actions">' +
          '<button class="btn btn-light btn-sm" onclick="renameGlobalTagPrompt(\'' + escapeHtml(tag.name).replace(/'/g, "\\'") + '\')">' + ic("pencil") + '</button>' +
          '<button class="btn btn-danger btn-sm" onclick="deleteGlobalTagConfirm(\'' + escapeHtml(tag.name).replace(/'/g, "\\'") + '\')">' + ic("trash") + '</button>' +
        '</div>' +
      '</div>';
    });
    h += '</div>';
  }
  h += '<div class="mt-3">' +
    '<div class="add-item-row">' +
      '<input id="global-tag-name-input" class="text-input" type="text" placeholder="' + t("tagName") + '" style="max-width:160px">' +
      '<button class="btn btn-light btn-sm" onclick="createGlobalTagFromInput()">' + ic("plus") + t("globalTagCreateBtn") + '</button>' +
    '</div></div>';
  h += '</div>';
  return h;
}

function renameGlobalTagPrompt(oldName) {
  var newName = prompt(t("globalTagRename") + ": " + oldName, oldName);
  if (!newName || newName === oldName) return;
  zones.forEach(function (z) {
    z.items.forEach(function (item) {
      (item.tags || []).forEach(function (tag) {
        if (tag.name === oldName) tag.name = newName;
      });
    });
  });
  persist();
  render();
  showToast(t("globalTagRenamed"));
}

function deleteGlobalTagConfirm(tagName) {
  confirmDialog(t("globalTagConfirmDelete"), function () {
    zones.forEach(function (z) {
      z.items.forEach(function (item) {
        item.tags = (item.tags || []).filter(function (tag) { return tag.name !== tagName; });
      });
    });
    persist();
    render();
    showToast(t("globalTagDeleted"));
  });
}

function createGlobalTagFromInput() {
  var input = document.getElementById("global-tag-name-input");
  var name = (input ? input.value : "").trim();
  if (!name) return;
  var colors = ["#E53935","#FB8C00","#FDD835","#43A047","#1E88E5","#8E24AA","#5C6BC0","#795548"];
  var color = colors[Math.floor(Math.random() * colors.length)];
  zones.forEach(function (z) {
    if (z.items.length) {
      var item = z.items[0];
      if (!item.tags) item.tags = [];
      item.tags.push({ name: name, color: color });
    }
  });
  persist();
  render();
  showToast(t("globalTagCreated"));
}

// ---- Init ----
(async function init() {
  const app = document.getElementById("app");
  app.innerHTML = '<p class="empty">' + t("loading") + "</p>";
  try { await Storage.init(); } catch (e) {}
  try {
    const data = await Storage.loadState();
    if (data && Array.isArray(data.zones)) {
      zones = data.zones;
      sessions = Array.isArray(data.sessions) ? data.sessions : [];
      selectedZoneIds = Array.isArray(data.selectedZoneIds) ? data.selectedZoneIds : [];
      if (typeof data.passThreshold === "number") passThreshold = data.passThreshold;
      ncs = Array.isArray(data.ncs) ? data.ncs : [];
      ncSettings = data.ncSettings && typeof data.ncSettings === "object" ? data.ncSettings : {};
    }
  } catch (e) {}
  try { await refreshFolderInfo(); } catch (e) {}
  render();
})();
