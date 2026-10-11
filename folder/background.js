// ===================== CONFIG (change ONLY the text inside the quotes) =====================
const CONFIG = {
  WEB_APP_URL: "https://script.google.com/macros/s/AKfycbyqwBS_CNSr8CsJVkHLDxbVKgQ8PMCdSAvDrNR8WU-MvVqIdzW0NaaMzEzZp1Hu3prTdA/exec",
  SECRET: "exam-logs-admin",
  FORM_ID: "",
};

const AI_DOMAINS = [
  "chatgpt.com", "chat.openai.com", "openai.com", "gemini.google.com",
  "claude.ai", "copilot.microsoft.com", "perplexity.ai", "poe.com",
  "deepseek.com", "chat.deepseek.com", "grok.com", "you.com", "bard.google.com"
];

// Matches /forms/d/e/ID/viewform, /forms/u/0/d/e/ID/viewform, /formResponse (not /edit)
const FORM_RE = /^https:\/\/docs\.google\.com\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?([^/?#]+)\/(?!edit)([a-zA-Z]+)/;
const PDF_RE = /\.pdf($|[?#])/i;

// ===================== HELPERS =====================
let chain = Promise.resolve();
const run = (fn) => {
  chain = chain.then(fn).catch((e) => console.error(e));
};

const getState = async () => (await chrome.storage.session.get("s")).s || { active: false };
const setState = (s) => chrome.storage.session.set({ s });

function parseForm(url) {
  const m = url && url.match(FORM_RE);
  if (!m) return null;
  if (CONFIG.FORM_ID && !url.includes(CONFIG.FORM_ID)) return null;
  return { formId: m[1], page: m[2] };
}

function classify(url) {
  url = url || "";
  try {
    if (!url || url === "about:blank" || /^(chrome|edge):\/\/newtab/.test(url)) return "NEW_BLANK_TAB";
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

// ===================== LOGGING =====================
async function log(state, event, extra) {
  extra = extra || {};
  const entry = {
    secret: CONFIG.SECRET,
    ts: new Date().toISOString(),
    email: state.email || "",
    formId: state.formId || "",
    event: event,
    category: extra.category || "",
    url: extra.url || "",
    title: extra.title || "",
    awaySeconds: extra.awaySeconds === undefined ? "" : extra.awaySeconds,
    note: extra.note || "",
  };
  const data = await chrome.storage.local.get("queue");
  let queue = data.queue || [];
  queue.push(entry);
  if (queue.length > 500) queue = queue.slice(queue.length - 500);
  await chrome.storage.local.set({ queue: queue });
  flush();
}

let flushing = false;
async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    const data = await chrome.storage.local.get("queue");
    const queue = data.queue || [];
    while (queue.length) {
      const res = await fetch(CONFIG.WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(queue[0]),
      });
      const txt = await res.text();
      if (!res.ok || txt.indexOf('"ok":true') === -1) {
        setSendStatus(false, "Server replied: " + txt.slice(0, 120));
        break;
      }
      queue.shift();
      await chrome.storage.local.set({ queue: queue });
      setSendStatus(true, "");
    }
  } catch (e) {
    setSendStatus(false, "Network error: " + e);
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

// ===================== SESSION =====================
async function startSession(tab, form) {
  const state = {
    active: true,
    formTabId: tab.id,
    formId: form.formId,
    email: await getEmail(),
    awayStart: null,
    lastAwayTabId: null,
  };
  await setState(state);
  chrome.action.setBadgeText({ text: "REC" });
  chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  await log(state, "SESSION_START", { url: tab.url, title: tab.title });
}

async function endSession(state, event, extra) {
  await log(state, event, extra);
  await setState({ active: false });
  chrome.action.setBadgeText({ text: "" });
}

async function handleActiveTab(tab) {
  const s = await getState();
  if (!s.active || !tab) return;

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
  if (s.lastAwayTabId === tab.id) return;
  if (!s.awayStart) s.awayStart = Date.now();
  s.lastAwayTabId = tab.id;
  await setState(s);
  const category = classify(tab.url || tab.pendingUrl);
  await log(s, "LEFT_FORM_TAB", { category: category, url: tab.url, title: tab.title });
}

// ===================== LISTENERS =====================
chrome.tabs.onUpdated.addListener((tabId, info, tab) => run(async () => {
  if (!info.url && info.status !== "complete") return;
  const s = await getState();
  const form = parseForm(tab.url);

  if (!s.active) {
    if (form) await startSession(tab, form);
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
  const s = await getState();
  if (!s.active) return;
  const u = tab.pendingUrl || tab.url;
  await log(s, "NEW_TAB_OPENED", { category: classify(u), url: u });
}));

chrome.windows.onCreated.addListener((win) => run(async () => {
  const s = await getState();
  if (!s.active) return;
  await log(s, "NEW_WINDOW_OPENED", { note: win.incognito ? "incognito" : "normal" });
}));

chrome.tabs.onActivated.addListener((activeInfo) => run(async () => {
  let tab = null;
  try { tab = await chrome.tabs.get(activeInfo.tabId); } catch (e) {}
  await handleActiveTab(tab);
}));

chrome.windows.onFocusChanged.addListener((windowId) => run(async () => {
  const s = await getState();
  if (!s.active) return;

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (!s.awayStart) {
      s.awayStart = Date.now();
      s.lastAwayTabId = "OUTSIDE";
      await setState(s);
    }
    await log(s, "BROWSER_LOST_FOCUS", { note: "Switched to another application or desktop" });
    return;
  }
  const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
  await handleActiveTab(tabs[0]);
}));

chrome.tabs.onRemoved.addListener((tabId) => run(async () => {
  const s = await getState();
  if (s.active && tabId === s.formTabId) await endSession(s, "FORM_TAB_CLOSED");
}));

chrome.runtime.onStartup.addListener(() => run(flush));
