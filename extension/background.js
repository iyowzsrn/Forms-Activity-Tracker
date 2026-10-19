// ===================== CONFIG (change ONLY the text inside the quotes) =====================
const CONFIG = {
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbyqwBS_CNSr8CsJVkHLDxbVKgQ8PMCdSAvDrNR8WU-MvVqIdzW0NaaMzEzZp1Hu3prTdA/exec",
  SECRET: "exam-logs-admin",

  // Sites that are ALWAYS allowed during an exam (needed for Google Forms to work).
  // Extra sites for each exam are added by the teacher in the dashboard.
  BASE_ALLOWLIST: [
    "docs.google.com/forms",
    "forms.gle",
    "forms.google.com",
    "accounts.google.com",
  ],

  // true  = TEST MODE: tabs that were already open before the exam starts are NOT restricted.
  // false = REAL EXAM: every tab is restricted, including tabs opened earlier.
  TEST_MODE: false,

  // "Left the browser" is only logged if focus stays away at least this many seconds.
  FOCUS_GRACE_SECONDS: 3,

  // If you edit the notice text in consent.html, change this so students must agree again.
  CONSENT_VERSION: "2.0",
};

const AI_DOMAINS = [
  "chatgpt.com", "chat.openai.com", "openai.com", "gemini.google.com",
  "claude.ai", "copilot.microsoft.com", "perplexity.ai", "poe.com",
  "deepseek.com", "chat.deepseek.com", "grok.com", "you.com", "bard.google.com"
];

const FORM_RE = /^https:\/\/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([^/?#]+)\/(?!edit)([a-zA-Z]+)/;
const PDF_RE = /\.pdf($|[?#])/i;
const NEWTAB_RE = /^(chrome|edge|chrome-search|chrome-untrusted):\/\/(newtab|new-tab-page|local-ntp|startpageview)/;

// New-tab pages are always allowed, so students can open a tab and type an address.
function isNewTabPage(url) {
  if (!url) return false;
  if (url === "about:blank" || NEWTAB_RE.test(url)) return true;
  try {
    const u = new URL(url);
    if (u.hostname === "ntp.msn.com") return true;  // Edge new tab page
    if (u.hostname === "www.google.com" && u.pathname.indexOf("/_/chrome/newtab") === 0) return true;  // Chrome new tab page
  } catch (e) {}
  return false;
}

// ===================== HELPERS =====================
// All event handling goes through this queue so state updates never overlap.
let chain = Promise.resolve();
const run = (fn) => {
  const p = chain.then(fn);
  chain = p.catch((e) => console.error(e));
  return p;
};

// Session state lives in storage.local so a "lock until exam ends" survives a browser restart.
const getState = async () => (await chrome.storage.local.get("s")).s || { active: false };
const setState = (s) => chrome.storage.local.set({ s });

function uid() {
  try { return crypto.randomUUID(); } catch (e) { return Date.now() + "-" + Math.random().toString(16).slice(2); }
}

function parseForm(url) {
  const m = url && url.match(FORM_RE);
  if (!m) return null;
  return { formId: m[1], page: m[2] };
}

function classify(url) {
  url = url || "";
  try {
    if (!url || isNewTabPage(url)) return "NEW_BLANK_TAB";
    if (PDF_RE.test(url)) return "PDF";
    const u = new URL(url);
    if (AI_DOMAINS.some((d) => u.hostname === d || u.hostname.endsWith("." + d))) return "AI_SITE";
    if (["chrome:", "edge:", "chrome-extension:", "extension:"].indexOf(u.protocol) !== -1) return "BROWSER_PAGE";
    return "OTHER_SITE";
  } catch (e) {
    return "OTHER_SITE";
  }
}

async function getEmail() {
  try {
    const p = chrome.identity.getProfileUserInfo({ accountStatus: "ANY" });
    const info = await Promise.race([p, new Promise((r) => setTimeout(() => r({}), 2000))]);
    return (info && info.email) || "";
  } catch (e) {
    return "";
  }
}

function updateBadge(s) {
  if (!s || !s.active) { chrome.action.setBadgeText({ text: "" }); return; }
  chrome.action.setBadgeText({ text: s.formTabId === null || s.formTabId === undefined ? "LOCK" : "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
}

// ===================== NETWORK + QUEUE =====================
async function postJson(obj, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    const res = await fetch(CONFIG.WEB_APP_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },  // avoids CORS preflight
      body: JSON.stringify(obj),
      signal: ctrl.signal,
    });
    return { ok: res.ok, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

// Every change to the saved event queue goes through here, one at a time (prevents lost events).
let qchain = Promise.resolve();
function qUpdate(fn) {
  const p = qchain.then(async () => {
    const data = await chrome.storage.local.get("queue");
    const q = data.queue || [];
    const r = fn(q);
    await chrome.storage.local.set({ queue: q });
    return r;
  });
  qchain = p.catch((e) => console.error(e));
  return p;
}
async function qRead() {
  await qchain;
  return (await chrome.storage.local.get("queue")).queue || [];
}

async function log(state, event, extra) {
  extra = extra || {};
  const cfgData = await chrome.storage.local.get("examConfig");
  const offset = cfgData.examConfig && cfgData.examConfig.offset ? cfgData.examConfig.offset : 0;
  const entry = {
    id: uid(),
    secret: CONFIG.SECRET,
    ts: new Date(Date.now() + offset).toISOString(),   // corrected to the server's clock
    email: state.email || "",
    name: state.name || "",
    studentId: state.studentId || "",
    consentVersion: state.consentVersion || "",
    examId: state.examId || "",
    examName: state.examName || "",
    formId: state.formId || "",
    event: event,
    category: extra.category || "",
    url: extra.url || "",
    title: extra.title || "",
    awaySeconds: extra.awaySeconds === undefined ? "" : extra.awaySeconds,
    note: extra.note || "",
  };
  await qUpdate((q) => {
    q.push(entry);
    if (q.length > 500) q.splice(0, q.length - 500);
  });
  flush();
}

async function sendEntry(entry) {
  try {
    const r = await postJson(entry, 15000);
    if (!r.ok || r.text.indexOf('"ok":true') === -1) {
      setSendStatus(false, "Server replied: " + r.text.slice(0, 120));
      return false;
    }
    setSendStatus(true, "");
    return true;
  } catch (e) {
    setSendStatus(false, "Network error: " + e);
    return false;
  }
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    while (true) {
      const q = await qRead();
      if (!q.length) break;
      const entry = q[0];
      const ok = await sendEntry(entry);
      if (!ok) break;
      await qUpdate((cur) => { if (cur.length && cur[0].id === entry.id) cur.shift(); });
    }
  } catch (e) {
    console.error("flush failed", e);
  }
  flushing = false;
}

// Hover over the extension icon to see the last send result.
function setSendStatus(ok, msg) {
  if (ok) {
    chrome.action.setTitle({ title: "Exam Focus Logger - last send OK " + new Date().toLocaleTimeString() });
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } else {
    chrome.action.setTitle({ title: "Exam Focus Logger - SEND FAILED. " + msg });
    chrome.action.setBadgeBackgroundColor({ color: "#f9ab00" });
  }
}

// ===================== EXAM SCHEDULE (from the teacher's dashboard) =====================
async function getConfig() {
  return (await chrome.storage.local.get("examConfig")).examConfig || null;
}

async function refreshConfig() {
  try {
    const r = await postJson({ action: "config", secret: CONFIG.SECRET }, 6000);
    const data = JSON.parse(r.text);
    if (!r.ok || !data || !data.ok) return false;
    await chrome.storage.local.set({
      examConfig: { exams: data.exams || [], offset: Number(data.serverNow) - Date.now(), fetchedAt: Date.now() },
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function ensureConfig() {
  let cfg = await getConfig();
  if (!cfg || Date.now() - cfg.fetchedAt > 30000) {
    await refreshConfig();
    cfg = await getConfig();
  }
  return cfg;
}

// The exam (if any) that is running right now for this form
function findExam(cfg, formId) {
  if (!cfg) return null;
  const now = Date.now() + (cfg.offset || 0);
  const list = cfg.exams || [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.formId === formId && e.start <= now && now < e.end) return e;
  }
  return null;
}

// ===================== CONSENT =====================
async function getConsent() {
  const data = await chrome.storage.local.get("consent");
  const c = data.consent;
  return c && c.version === CONFIG.CONSENT_VERSION ? c : null;
}

// Opens the consent page (once). formTabId lets us start monitoring right after the student agrees.
async function promptConsent(formTabId) {
  const base = chrome.runtime.getURL("consent.html");
  const tabs = await chrome.tabs.query({});
  if (tabs.some((t) => t.url && t.url.indexOf(base) === 0)) return;
  const url = formTabId === null || formTabId === undefined ? base : base + "?tab=" + formTabId;
  await chrome.tabs.create({ url: url, active: true });
}

async function handleAgree(msg) {
  const name = String(msg.name || "").trim().slice(0, 100);
  const studentId = String(msg.studentId || "").trim().slice(0, 50);
  if (name.length < 2 || studentId.length < 1) {
    return { ok: false, error: "Please enter your full name and student ID." };
  }
  const consent = { name: name, studentId: studentId, version: CONFIG.CONSENT_VERSION, at: new Date().toISOString() };
  await chrome.storage.local.set({ consent: consent });

  const email = await getEmail();
  await log({ email: email, name: name, studentId: studentId, consentVersion: consent.version }, "CONSENT_GIVEN", {});

  // Start monitoring on the form tab that triggered the prompt (no reload needed)
  if (msg.formTabId !== null && msg.formTabId !== undefined) {
    try {
      const tab = await chrome.tabs.get(Number(msg.formTabId));
      const form = parseForm(tab.url);
      const s = await getActive();
      if (form && !s.active) {
        const cfg = await ensureConfig();
        const exam = findExam(cfg, form.formId);
        if (exam) await startSession(tab, form, consent, exam, (cfg && cfg.offset) || 0);
      }
    } catch (e) { /* tab closed */ }
  }
  return { ok: true };
}

async function handleWithdraw() {
  const data = await chrome.storage.local.get("consent");
  const consent = data.consent;
  if (!consent) return { ok: true };

  const s = await getState();
  if (s.active) await endSession(s, "MONITORING_STOPPED", { note: "Consent withdrawn" });

  const email = await getEmail();
  await log({ email: email, name: consent.name, studentId: consent.studentId, consentVersion: consent.version }, "CONSENT_WITHDRAWN", {});
  await chrome.storage.local.remove("consent");
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;
  let p = null;
  if (msg.type === "CONSENT_AGREE") p = run(() => handleAgree(msg));
  else if (msg.type === "CONSENT_WITHDRAW") p = run(() => handleWithdraw());
  if (!p) return false;
  p.then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// Show the consent page right after installing
chrome.runtime.onInstalled.addListener((details) => run(async () => {
  if (details.reason === "install") await promptConsent(null);
}));

// ===================== ALLOWLIST =====================
function isOurPage(url) {
  return !!url && url.indexOf(chrome.runtime.getURL("")) === 0;
}

function isAllowed(url, allow) {
  if (!url) return true;
  if (isOurPage(url)) return true;
  if (isNewTabPage(url)) return true;
  if (PDF_RE.test(url)) return false;

  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;

  // Never allow the Google Forms editor (it could be used as a notepad)
  if (u.hostname === "docs.google.com" && /^\/forms\/.*\/edit(\/|$)/.test(u.pathname)) return false;

  const list = allow || CONFIG.BASE_ALLOWLIST;
  return list.some(function (rule) {
    const slash = rule.indexOf("/");
    const host = slash === -1 ? rule : rule.slice(0, slash);
    const path = slash === -1 ? "" : rule.slice(slash).replace(/\/+$/, "");
    const hostOk = u.hostname === host || u.hostname.endsWith("." + host);
    const pathOk = !path || u.pathname === path || u.pathname.indexOf(path + "/") === 0;
    return hostOk && pathOk;
  });
}

// In TEST_MODE, tabs that were already open before the exam started are left alone.
function isExempt(s, tabId) {
  return CONFIG.TEST_MODE && (s.preTabs || []).indexOf(tabId) !== -1;
}

async function blockTab(s, tabId, url) {
  const target = chrome.runtime.getURL("blocked.html") + "?u=" + encodeURIComponent(url || "");
  try { await chrome.tabs.update(tabId, { url: target }); } catch (e) { /* tab may be gone */ }

  const last = s.lastBlock;
  if (last && last.tabId === tabId && last.url === url && Date.now() - last.ts < 4000) return;
  s.lastBlock = { tabId: tabId, url: url, ts: Date.now() };
  await setState(s);
  await log(s, "BLOCKED_NAVIGATION", { category: classify(url), url: url, note: "Blocked by allowlist" });
}

// ===================== SESSION =====================
async function startSession(tab, form, consent, exam, offset) {
  const all = await chrome.tabs.query({});
  const state = {
    active: true,
    examId: exam.id,
    examName: exam.name,
    examEnd: exam.end,
    lock: !!exam.lock,
    allow: CONFIG.BASE_ALLOWLIST.concat(exam.allowlist || []),
    offset: offset || 0,
    formTabId: tab.id,
    formId: form.formId,
    email: await getEmail(),
    name: consent.name,
    studentId: consent.studentId,
    consentVersion: consent.version,
    awayStart: null,
    lastAwayTabId: null,
    lastBlock: null,
    blurAt: null,
    blurLogged: false,
    preTabs: all.map((t) => t.id).filter((id) => id !== tab.id),
  };
  await setState(state);
  updateBadge(state);
  await log(state, "SESSION_START", { url: tab.url, title: tab.title });

  // REAL EXAM: replace every other open tab that is not allowed
  if (!CONFIG.TEST_MODE) {
    for (const t of all) {
      if (t.id === tab.id) continue;
      if (!isAllowed(t.url, state.allow)) await blockTab(state, t.id, t.url);
    }
  }
}

async function endSession(state, event, extra) {
  await log(state, event, extra);
  await setState({ active: false });
  updateBadge({ active: false });
}

// Returns the current session, ending it first if the exam window is over
async function getActive() {
  const s = await getState();
  if (!s.active) return s;
  if (Date.now() + (s.offset || 0) >= s.examEnd) {
    await endSession(s, "EXAM_ENDED", { note: "Exam window ended" });
    return { active: false };
  }
  return s;
}

// Runs every minute: picks up changes the teacher made (end now, new allowed sites)
async function syncTick() {
  await refreshConfig();
  const s = await getState();
  if (s.active) {
    const cfg = await getConfig();
    const list = (cfg && cfg.exams) || [];
    let exam = null;
    for (let i = 0; i < list.length; i++) if (list[i].id === s.examId) exam = list[i];
    if (!exam) {
      await endSession(s, "EXAM_ENDED", { note: "Exam ended or removed by the teacher" });
    } else {
      s.examEnd = exam.end;
      s.lock = !!exam.lock;
      s.allow = CONFIG.BASE_ALLOWLIST.concat(exam.allowlist || []);
      s.offset = cfg.offset || 0;
      await setState(s);
      await getActive();
    }
  }
  flush();
}

async function handleActiveTab(tab) {
  const s = await getActive();
  if (!s.active || !tab) return;

  // Form closed but exam still locked: only keep blocking
  if (s.formTabId === null || s.formTabId === undefined) {
    if (!isAllowed(tab.url, s.allow) && !isExempt(s, tab.id)) await blockTab(s, tab.id, tab.url);
    return;
  }

  if (tab.id === s.formTabId) {
    if (s.awayStart) {
      const secs = Math.round((Date.now() - s.awayStart) / 1000);
      s.awayStart = null;
      s.lastAwayTabId = null;
      await setState(s);
      await log(s, "RETURNED_TO_FORM", { awaySeconds: secs });
    }
    return;
  }

  // Switched to a tab that is not allowed: replace it with the blocked page
  if (!isAllowed(tab.url, s.allow) && !isExempt(s, tab.id)) {
    await blockTab(s, tab.id, tab.url);
  }

  if (s.lastAwayTabId === tab.id) return;
  if (!s.awayStart) s.awayStart = Date.now();
  s.lastAwayTabId = tab.id;
  await setState(s);
  const category = classify(tab.url || tab.pendingUrl);
  await log(s, "LEFT_FORM_TAB", { category: category, url: tab.url, title: tab.title });
}

// ===================== LISTENERS =====================
// Blocks real page loads (any tab, any window) the moment they start
chrome.webNavigation.onBeforeNavigate.addListener((d) => run(async () => {
  if (d.frameId !== 0) return;
  const s = await getActive();
  if (!s.active) return;
  if (isAllowed(d.url, s.allow) || isExempt(s, d.tabId)) return;
  await blockTab(s, d.tabId, d.url);
}));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => run(async () => {
  if (!info.url && info.status !== "complete") return;
  const s = await getActive();
  const form = parseForm(tab.url);

  // No session yet: start one only if this form belongs to an exam running right now
  if (!s.active) {
    if (form) {
      const cfg = await ensureConfig();
      const exam = findExam(cfg, form.formId);
      if (exam) {
        const consent = await getConsent();
        if (consent) await startSession(tab, form, consent, exam, (cfg && cfg.offset) || 0);
        else await promptConsent(tabId);
      }
    }
    return;
  }

  // Browser/internal/file pages may not trigger webNavigation, so catch them here
  if (info.url && !/^https?:/i.test(info.url) && !isAllowed(info.url, s.allow) && !isExempt(s, tabId)) {
    await blockTab(s, tabId, info.url);
    return;
  }

  if (isOurPage(tab.url)) return;

  // Exam locked but form was closed: re-attach when the student opens the exam form again
  if (s.formTabId === null || s.formTabId === undefined) {
    if (form && form.formId === s.formId && info.url) {
      s.formTabId = tabId;
      s.awayStart = null;
      s.lastAwayTabId = null;
      await setState(s);
      updateBadge(s);
      await log(s, "FORM_REOPENED", { url: tab.url, title: tab.title });
    }
    return;
  }

  if (tabId === s.formTabId) {
    if (form) {
      // Google uses /formResponse for both "Next" and final "Submit"
      if (form.page === "formResponse" && info.url) {
        await log(s, "FORM_RESPONSE_PAGE", { url: tab.url, title: tab.title, note: "Next page or submitted" });
      }
      return;
    }
    if (info.url) {
      await log(s, "FORM_TAB_NAVIGATED_AWAY", { category: classify(tab.url), url: tab.url, title: tab.title });
    }
    return;
  }

  if (info.url) {
    await log(s, "OTHER_TAB_URL", { category: classify(info.url), url: info.url, title: tab.title });
  }
}));

chrome.tabs.onCreated.addListener((tab) => run(async () => {
  const s = await getActive();
  if (!s.active || s.formTabId === null || s.formTabId === undefined) return;
  const u = tab.pendingUrl || tab.url;
  await log(s, "NEW_TAB_OPENED", { category: classify(u), url: u });
}));

chrome.windows.onCreated.addListener((win) => run(async () => {
  const s = await getActive();
  if (!s.active || s.formTabId === null || s.formTabId === undefined) return;
  await log(s, "NEW_WINDOW_OPENED", { note: win.incognito ? "incognito" : "normal" });
}));

chrome.tabs.onActivated.addListener((activeInfo) => run(async () => {
  let tab = null;
  try { tab = await chrome.tabs.get(activeInfo.tabId); } catch (e) {}
  await handleActiveTab(tab);
}));

// Called after the grace period: logs only if focus is STILL away from the browser
async function confirmFocusLost(token) {
  const s = await getState();
  if (!s.active || s.blurAt !== token || s.blurLogged) return;
  s.blurLogged = true;
  if (!s.awayStart) {
    s.awayStart = token;
    s.lastAwayTabId = "OUTSIDE";
  }
  await setState(s);
  await log(s, "BROWSER_LOST_FOCUS", { note: "Away from the browser for " + CONFIG.FOCUS_GRACE_SECONDS + "+ seconds" });
}

chrome.windows.onFocusChanged.addListener((windowId) => run(async () => {
  const s = await getActive();
  if (!s.active || s.formTabId === null || s.formTabId === undefined) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (s.blurAt) return;
    s.blurAt = Date.now();
    s.blurLogged = false;
    await setState(s);
    const token = s.blurAt;
    setTimeout(() => run(() => confirmFocusLost(token)), CONFIG.FOCUS_GRACE_SECONDS * 1000);
    return;
  }

  if (s.blurAt) {
    s.blurAt = null;
    s.blurLogged = false;
    await setState(s);
  }
  const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
  await handleActiveTab(tabs[0]);
}));

chrome.tabs.onRemoved.addListener((tabId) => run(async () => {
  const s = await getActive();
  if (!s.active || tabId !== s.formTabId) return;

  if (s.lock) {
    // Keep restrictions on until the exam ends, even though the form was closed
    s.formTabId = null;
    s.awayStart = null;
    s.lastAwayTabId = null;
    s.blurAt = null;
    s.blurLogged = false;
    await setState(s);
    updateBadge(s);
    await log(s, "FORM_TAB_CLOSED", { note: "Restrictions stay on until the exam ends" });
  } else {
    await endSession(s, "FORM_TAB_CLOSED");
  }
}));

// ===================== STARTUP + SCHEDULE SYNC =====================
chrome.runtime.onStartup.addListener(() => run(async () => {
  await refreshConfig();
  const s = await getState();
  if (s.active) {
    if (s.lock) {
      // Browser was restarted during a locked exam: keep restrictions, form tab is gone
      s.formTabId = null;
      s.awayStart = null;
      s.lastAwayTabId = null;
      s.blurAt = null;
      s.blurLogged = false;
      s.preTabs = [];
      await setState(s);
      await getActive();
    } else {
      await endSession(s, "FORM_TAB_CLOSED", { note: "Browser restarted" });
    }
  }
  updateBadge(await getState());
  flush();
}));

chrome.alarms.get("sync", (a) => {
  if (!a) chrome.alarms.create("sync", { periodInMinutes: 1 });
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "sync") run(syncTick);
});
