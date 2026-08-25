// ---------------------------------------------------------------------------
// storage.js  —  Persistent local database
//
// Persistence hierarchy (most durable / user-owned first):
//   1. File System Access API  -> a real file (audit-data.json) in a folder the
//      user picks once. This is the on-disk "database" that survives everything
//      and is fully under the user's control. The folder handle is remembered
//      in IndexedDB so the app can re-use it on later launches.
//   2. IndexedDB              -> used when the file API is unavailable (Firefox/
//      Safari) or before a folder has been chosen.
//   3. localStorage           -> last-resort fallback.
//
// JSON file import/export remains the portable backup of the whole database.
// Exposes: window.Storage
// ---------------------------------------------------------------------------

const DB_NAME = "checklist-audit-db";
const DB_VERSION = 1;
const STATE_STORE = "state";
const HANDLE_STORE = "handles";
const RECORD_KEY = "main";
const HANDLE_KEY = "dbFolder";
const FILE_NAME = "audit-data.json";

const LS_STATE_KEY = "checklist-audit-v1";
const LANG_KEY = "checklist-audit-lang";
const USER_KEY = "checklist-audit-user";

// Feature-detect the File System Access API. It requires a secure context
// (HTTPS or localhost); a bare file:// double-click is NOT a secure context,
// so we must check isSecureContext (otherwise the picker throws SecurityError).
const FS_SUPPORTED = (typeof window !== "undefined")
  && "showDirectoryPicker" in window
  && window.isSecureContext === true;

// Module-scoped, set during init / folder pick
let folderHandle = null;

// ---- Low-level IndexedDB helpers ----
function openDB() {
  return new Promise(function (resolve, reject) {
    if (typeof indexedDB === "undefined") { reject(new Error("indexedDB unavailable")); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE);
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function idbGet(db, store, key) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}
function idbPut(db, store, key, value) {
  return new Promise(function (resolve, reject) {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = function () { resolve(); };
    tx.onerror = function () { reject(tx.error); };
  });
}

// ---- Folder handle persistence (remembered across launches) ----
async function storeHandle(h) {
  try { const db = await openDB(); await idbPut(db, HANDLE_STORE, HANDLE_KEY, h); } catch (e) {}
}
async function getStoredHandle() {
  try { const db = await openDB(); return await idbGet(db, HANDLE_STORE, HANDLE_KEY); }
  catch (e) { return null; }
}

// ---- File System Access helpers ----
async function ensurePermission(h) {
  try {
    const opts = { mode: "readwrite" };
    if ((await h.queryPermission(opts)) === "granted") return true;
    return (await h.requestPermission(opts)) === "granted";
  } catch (e) { return false; }
}
async function readFile(h) {
  try {
    const fh = await h.getFileHandle(FILE_NAME, { create: false });
    const file = await fh.getFile();
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.zones)) return null;
    return data;
  } catch (e) { return null; }
}
async function writeFile(h, state) {
  const fh = await h.getFileHandle(FILE_NAME, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(state));
  await w.close();
}
function folderConnected() {
  if (!FS_SUPPORTED || !folderHandle) return false;
  return folderHandle.queryPermission({ mode: "readwrite" })
    .then(r => r === "granted")
    .catch(() => false);
}

// Serialize writes so rapid saves can never interleave out of order (the last
// write always wins, and no two file writes race on the same JSON file).
let saveChain = Promise.resolve();
async function doSave(state) {
  if (FS_SUPPORTED && folderHandle && (await ensurePermission(folderHandle))) {
    try { await writeFile(folderHandle, state); return; } catch (e) {}
  }
  // Fallback: IndexedDB
  try {
    const db = await openDB();
    await idbPut(db, STATE_STORE, RECORD_KEY, state);
    return;
  } catch (e) {}
  // Fallback: localStorage
  try { localStorage.setItem(LS_STATE_KEY, JSON.stringify(state)); } catch (e2) {}
}

window.Storage = {
  isFSSupported() { return FS_SUPPORTED; },

  // Restore the remembered folder handle (no permission prompt yet).
  async init() {
    if (!FS_SUPPORTED) return;
    try { folderHandle = await getStoredHandle(); } catch (e) { folderHandle = null; }
  },

  // Status for the UI: { supported, hasHandle, connected, name }
  async getFolderInfo() {
    if (!FS_SUPPORTED) return { supported: false, hasHandle: false, connected: false, name: "" };
    let connected = false;
    try { connected = (await folderHandle.queryPermission({ mode: "readwrite" })) === "granted"; }
    catch (e) { connected = false; }
    return {
      supported: true,
      hasHandle: !!folderHandle,
      connected: connected,
      name: folderHandle ? folderHandle.name : ""
    };
  },

  // Called from a user gesture (button). Picks a folder and stores it.
  async chooseFolder() {
    if (!FS_SUPPORTED) return false;
    const h = await window.showDirectoryPicker({ mode: "readwrite" });
    folderHandle = h;
    await storeHandle(h);
    return true;
  },

  // Called from a user gesture. Re-grants access to a previously picked folder.
  async connectFolder() {
    if (!FS_SUPPORTED || !folderHandle) return false;
    return await ensurePermission(folderHandle);
  },

  // ---- App state (the audit database) ----
  async loadState() {
    if (FS_SUPPORTED && folderHandle && (await ensurePermission(folderHandle))) {
      const d = await readFile(folderHandle);
      if (d) return d;
    }
    // Fallback: IndexedDB
    try {
      const db = await openDB();
      const d = await idbGet(db, STATE_STORE, RECORD_KEY);
      if (d && Array.isArray(d.zones)) return d;
    } catch (e) {}
    // Fallback: localStorage
    try {
      const raw = localStorage.getItem(LS_STATE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && Array.isArray(d.zones)) return d;
      }
    } catch (e) {}
    return null;
  },

  async saveState(state) {
    saveChain = saveChain.then(function () { return doSave(state); }).catch(function () {});
    return saveChain;
  },

  // ---- Language preference (small, kept in localStorage) ----
  getLang() {
    const l = localStorage.getItem(LANG_KEY);
    return (l === "fr" || l === "en") ? l : "en";
  },
  setLang(l) { try { localStorage.setItem(LANG_KEY, l); } catch (e) {} },

  // ---- Inspector identity (small, kept in localStorage) ----
  getUser() { return localStorage.getItem(USER_KEY); },
  setUser(u) { try { localStorage.setItem(USER_KEY, u); } catch (e) {} },

  // ---- JSON file export (portable database backup) ----
  exportJSON(state) {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = "audit-export-" + date + ".json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // ---- JSON file import (returns a Promise) ----
  importJSON(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error("no file")); return; }
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.zones)) throw new Error("bad shape");
          resolve(data);
        } catch (e) { reject(e); }
      };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsText(file);
    });
  }
};
