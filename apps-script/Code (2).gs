// ============================================================================
// Exam Focus Logger - server (Google Apps Script)
//   * doPost : receives events from the student extension, and serves the exam schedule
//   * doGet  : serves the teacher dashboard (Dashboard.html) to approved teachers only
// ============================================================================

const SECRET = "change-me";                    // <-- the SAME secret as in background.js
const TEACHER_EMAILS = ["teacher@example.com"]; // <-- your Google account(s) allowed to open the dashboard
const TZ = "Asia/Manila";

const SHEET_NAME = "Exam Log";       // readable log
const CONSENT_SHEET = "Consents";    // who agreed / withdrew
const EVENTS_SHEET = "Events";       // raw data used by the dashboard (do not edit)
const EXAMS_SHEET = "Exams";         // exam schedule (managed from the dashboard)

const HEADERS = ["Date", "Time", "Name", "Student ID", "Email", "Event", "Site", "Page title", "Away (sec)", "Flag", "Exam"];
const CONSENT_HEADERS = ["Date", "Time", "Name", "Student ID", "Email", "Action", "Notice version"];
const EVENT_HEADERS = ["ts", "examId", "examName", "name", "studentId", "email", "code", "category", "site", "url", "title", "awaySeconds", "note"];
const EXAM_HEADERS = ["ID", "Name", "Form ID", "Start (ms)", "End (ms)", "Extra allowed sites", "Lock until end", "Created by", "Updated", "Start (readable)", "End (readable)"];

const EVENT_LABELS = {
  SESSION_START: "Started form",
  FORM_REOPENED: "Reopened form",
  FORM_SUBMITTED: "Submitted form",
  FORM_TAB_CLOSED: "Closed form",
  LEFT_FORM_TAB: "Left form tab",
  RETURNED_TO_FORM: "Returned to form",
  NEW_TAB_OPENED: "Opened new tab",
  NEW_WINDOW_OPENED: "Opened new window",
  OTHER_TAB_URL: "Visited page in another tab",
  BROWSER_LOST_FOCUS: "Left the browser",
  FORM_TAB_NAVIGATED_AWAY: "Form tab went elsewhere",
  FORM_RESPONSE_PAGE: "Next page / submitted",
  BLOCKED_NAVIGATION: "Blocked by allowlist",
  MONITORING_STOPPED: "Monitoring stopped",
  EXAM_ENDED: "Exam ended"
};

// Run this ONCE from the editor (select authorizeOnce, click Run) to grant permissions.
function authorizeOnce() {
  SpreadsheetApp.getActiveSpreadsheet();
  Session.getActiveUser().getEmail();
  Logger.log("Authorized.");
}

// ============================================================================
// Teacher access control
// ============================================================================
function currentUser_() {
  try { return String(Session.getActiveUser().getEmail() || "").toLowerCase(); } catch (e) { return ""; }
}
function isTeacher_(email) {
  if (!email) return false;
  return TEACHER_EMAILS.map(function (x) { return String(x).toLowerCase(); }).indexOf(email) !== -1;
}
function requireTeacher_() {
  const email = currentUser_();
  if (!isTeacher_(email)) throw new Error("Not authorized");
  return email;
}
function escapeHtml_(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ============================================================================
// Web app entry points
// ============================================================================
function doGet(e) {
  if (e && e.parameter && e.parameter.ping) return out({ ok: true, service: "exam-focus-logger" });

  const email = currentUser_();
  if (!isTeacher_(email)) {
    const who = email ? "You are signed in as " + escapeHtml_(email) + ", which is not on the teacher list." :
      "Open the teacher dashboard link while signed in to your Google account.";
    return HtmlService.createHtmlOutput(
      '<div style="font-family:system-ui,sans-serif;max-width:480px;margin:60px auto;padding:0 16px">' +
      "<h2>Access denied</h2><p>" + who + "</p></div>"
    ).setTitle("Access denied");
  }
  const t = HtmlService.createTemplateFromFile("Dashboard");
  t.userEmail = email;
  return t.evaluate()
    .setTitle("Exam Monitor")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.secret !== SECRET) return out({ ok: false, error: "unauthorized" });

    // The extension asks for the exam schedule (no lock needed, read-only)
    if (d.action === "config") {
      return out({ ok: true, serverNow: Date.now(), exams: examsForExtension_() });
    }

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      let ts = new Date(d.ts).getTime();
      if (isNaN(ts)) ts = Date.now();
      const when = new Date(ts);
      const date = Utilities.formatDate(when, TZ, "yyyy-MM-dd");
      const time = Utilities.formatDate(when, TZ, "HH:mm:ss");

      if (d.event === "CONSENT_GIVEN" || d.event === "CONSENT_WITHDRAWN") {
        const cs = getSheet_(CONSENT_SHEET, CONSENT_HEADERS, [95, 75, 170, 100, 200, 100, 110], false);
        cs.appendRow([date, time, safe_(d.name), safe_(d.studentId), safe_(d.email),
                      d.event === "CONSENT_GIVEN" ? "Agreed" : "Withdrew", safe_(d.consentVersion)]);
        return out({ ok: true });
      }

      const away = d.awaySeconds === "" || d.awaySeconds === undefined ? "" : Number(d.awaySeconds);

      // 1) readable log
      const sheet = getSheet_(SHEET_NAME, HEADERS, [95, 75, 170, 100, 200, 190, 180, 340, 85, 110, 160], true);
      sheet.appendRow([
        date, time,
        safe_(d.name) || "(no name)", safe_(d.studentId), safe_(d.email),
        EVENT_LABELS[d.event] || safe_(d.event),
        safe_(siteOf_(d.url)),
        safe_(String(d.title || "").slice(0, 200)),
        away,
        flagOf_(d),
        safe_(d.examName)
      ]);

      // 2) raw data for the dashboard
      const ev = getSheet_(EVENTS_SHEET, EVENT_HEADERS, [140, 90, 160, 160, 100, 200, 160, 110, 160, 300, 260, 90, 200], false);
      ev.appendRow([
        ts, String(d.examId || ""), safe_(d.examName), safe_(d.name), safe_(d.studentId), safe_(d.email),
        String(d.event || ""), String(d.category || ""), safe_(siteOf_(d.url)),
        safe_(String(d.url || "").slice(0, 500)), safe_(String(d.title || "").slice(0, 200)), away, safe_(d.note)
      ]);
      return out({ ok: true });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// Helpers
// ============================================================================
// Stops spreadsheet formulas in student-controlled text (names, page titles) from running.
function safe_(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}

function siteOf_(url) {
  if (!url) return "";
  if (/^(edge|chrome|chrome-extension|extension|about):/i.test(url)) return "Browser page";
  if (/^file:/i.test(url)) return "Local file";
  const m = String(url).match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].replace(/^www\./, "") : String(url);
}

function flagOf_(d) {
  if (d.event === "BLOCKED_NAVIGATION") return "Blocked";
  if (d.event === "MONITORING_STOPPED") return "Consent withdrawn";
  if (d.category === "AI_SITE") return "AI site";
  if (d.category === "PDF") return "PDF";
  if (d.event === "NEW_WINDOW_OPENED" && d.note === "incognito") return "Private window";
  if (d.event === "BROWSER_LOST_FOCUS") return "Other app";
  return "";
}

function styleHeader_(range) {
  range.setFontWeight("bold").setFontColor("#ffffff").setBackground("#1e6b52");
}

// Creates and formats a sheet tab the first time only.
function getSheet_(name, headers, widths, flagColumn) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (sheet) {
    // Older versions had no "Exam" column in the readable log: add the header
    if (name === SHEET_NAME && sheet.getRange(1, 11).getValue() !== "Exam") {
      sheet.getRange(1, 11).setValue("Exam");
      styleHeader_(sheet.getRange(1, 11));
      sheet.setColumnWidth(11, 160);
    }
    return sheet;
  }

  sheet = ss.insertSheet(name);
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  styleHeader_(sheet.getRange(1, 1, 1, headers.length));
  widths.forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });

  if (name === EVENTS_SHEET) {
    sheet.getRange("A2:A").setNumberFormat("0");
    return sheet;
  }

  sheet.getRange("A2:A").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("B2:B").setNumberFormat("hh:mm:ss");
  if (flagColumn) {
    sheet.getRange("H2:H").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
    const rule = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=$J2<>""')
      .setBackground("#fce8e6")
      .setRanges([sheet.getRange("A2:K1000")])
      .build();
    sheet.setConditionalFormatRules([rule]);
  }
  try { sheet.getRange(1, 1, sheet.getMaxRows(), headers.length).createFilter(); } catch (e) {}
  return sheet;
}

// ============================================================================
// Exams (stored in the "Exams" tab, managed from the dashboard)
// ============================================================================
function examsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(EXAMS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EXAMS_SHEET);
    sh.appendRow(EXAM_HEADERS);
    sh.setFrozenRows(1);
    styleHeader_(sh.getRange(1, 1, 1, EXAM_HEADERS.length));
    sh.getRange("D2:E").setNumberFormat("0");
    [90, 200, 260, 130, 130, 240, 110, 200, 160, 170, 170].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  }
  return sh;
}

function readExams_() {
  const sh = examsSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 7).getValues().map(function (r) {
    return {
      id: String(r[0] || ""),
      name: String(r[1] || ""),
      formId: String(r[2] || ""),
      start: Number(r[3]),
      end: Number(r[4]),
      allowlist: String(r[5] || "").split("\n").map(function (x) { return x.trim(); }).filter(Boolean),
      lock: r[6] === true || String(r[6]).toUpperCase() === "TRUE"
    };
  }).filter(function (e) { return e.id; });
}

// Exams the extension should know about: anything that has not ended yet
function examsForExtension_() {
  const now = Date.now();
  return readExams_().filter(function (e) { return e.end > now; });
}

function fmt_(ms) { return Utilities.formatDate(new Date(ms), TZ, "yyyy-MM-dd HH:mm"); }

function parseFormId_(input) {
  const s = String(input || "").trim();
  if (/\/forms\/(?:u\/\d+\/)?d\/[^\/]+\/edit/.test(s)) {
    throw new Error("That is the editor link. In Google Forms click Send, then the link icon, and paste that link (it contains /d/e/ and ends in /viewform).");
  }
  const m = s.match(/\/forms\/(?:u\/\d+\/)?d\/e\/([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  throw new Error("Could not find the form ID. Paste the form's public link (Send > link icon, with 'Shorten URL' turned off).");
}

const BROAD_HOSTS_ = ["google.com", "docs.google.com", "drive.google.com", "microsoft.com", "office.com", "live.com",
  "sharepoint.com", "onedrive.live.com", "bing.com", "openai.com", "chatgpt.com", "notion.so", "youtube.com"];

function parseAllowlist_(text) {
  const list = [], warnings = [];
  String(text || "").split(/[\n,]+/).forEach(function (line) {
    let v = line.trim().toLowerCase();
    if (!v) return;
    v = v.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/, "");
    const host = v.split("/")[0];
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host) || host.indexOf(".") === -1 || /\s/.test(v)) {
      throw new Error('"' + line.trim() + '" is not a valid site. Use a domain such as desmos.com');
    }
    if (BROAD_HOSTS_.indexOf(host) !== -1 && v === host) {
      warnings.push(host + " is very broad and may allow tools students could use for notes or answers.");
    }
    if (list.indexOf(v) === -1) list.push(v);
  });
  return { list: list, warnings: warnings };
}

// ============================================================================
// Dashboard API (every function checks that the caller is an approved teacher)
// ============================================================================
function api_listExams() {
  requireTeacher_();
  const now = Date.now();
  return readExams_().map(function (e) {
    e.status = now < e.start ? "upcoming" : (now < e.end ? "live" : "ended");
    return e;
  }).sort(function (a, b) { return b.start - a.start; });
}

function api_saveExam(ex) {
  const email = requireTeacher_();
  const name = String(ex.name || "").trim().slice(0, 100);
  if (!name) throw new Error("Please enter an exam name.");
  const formId = parseFormId_(ex.link);
  const start = Number(ex.startMs), end = Number(ex.endMs);
  if (!isFinite(start) || !isFinite(end)) throw new Error("Please choose a start and end time.");
  if (end <= start) throw new Error("The end time must be after the start time.");
  const al = parseAllowlist_(ex.allowlistText);
  const lock = !!ex.lock;

  const lockSvc = LockService.getScriptLock();
  lockSvc.waitLock(20000);
  try {
    const sh = examsSheet_();
    const row = [null, name, formId, start, end, al.list.join("\n"), lock, email,
                 Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"), fmt_(start), fmt_(end)];
    let id = String(ex.id || "");
    let rowIndex = -1;
    if (id) {
      const last = sh.getLastRow();
      if (last >= 2) {
        const ids = sh.getRange(2, 1, last - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { rowIndex = i + 2; break; }
      }
    }
    if (rowIndex === -1) {
      id = Utilities.getUuid().slice(0, 8);
      row[0] = id;
      sh.appendRow(row);
    } else {
      row[0] = id;
      sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    }
    return { ok: true, id: id, warnings: al.warnings };
  } finally {
    lockSvc.releaseLock();
  }
}

function api_endExam(id) {
  requireTeacher_();
  const lockSvc = LockService.getScriptLock();
  lockSvc.waitLock(20000);
  try {
    const sh = examsSheet_();
    const last = sh.getLastRow();
    if (last < 2) throw new Error("Exam not found");
    const vals = sh.getRange(2, 1, last - 1, 5).getValues();
    for (let i = 0; i < vals.length; i++) {
      if (String(vals[i][0]) === String(id)) {
        const now = Date.now();
        const start = Number(vals[i][3]);
        // If it has not started yet, ending it now would make end < start; move start too
        if (now < start) {
          sh.getRange(i + 2, 4).setValue(now - 1000);
          sh.getRange(i + 2, 10).setValue(fmt_(now - 1000));
        }
        sh.getRange(i + 2, 5).setValue(now);
        sh.getRange(i + 2, 11).setValue(fmt_(now));
        return { ok: true };
      }
    }
    throw new Error("Exam not found");
  } finally {
    lockSvc.releaseLock();
  }
}

function api_deleteExam(id) {
  requireTeacher_();
  const lockSvc = LockService.getScriptLock();
  lockSvc.waitLock(20000);
  try {
    const sh = examsSheet_();
    const last = sh.getLastRow();
    if (last < 2) return { ok: true };
    const ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) { sh.deleteRow(i + 2); break; }
    }
    return { ok: true };
  } finally {
    lockSvc.releaseLock();
  }
}

// Reads the raw events (newest 20,000 rows at most)
function eventRows_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(EVENTS_SHEET);
  if (!sh) return [];
  const last = sh.getLastRow();
  if (last < 2) return [];
  const first = Math.max(2, last - 19999);
  return sh.getRange(first, 1, last - first + 1, EVENT_HEADERS.length).getValues().map(function (r) {
    return {
      ts: Number(r[0]), examId: String(r[1]), name: String(r[3]), studentId: String(r[4]), email: String(r[5]),
      code: String(r[6]), category: String(r[7]), site: String(r[8]), url: String(r[9]), title: String(r[10]),
      away: r[11] === "" ? 0 : Number(r[11]), note: String(r[12])
    };
  });
}

function studentKey_(r) { return r.studentId || r.name || r.email || "?"; }

function api_getMonitor(examId) {
  requireTeacher_();
  const exam = readExams_().filter(function (e) { return e.id === String(examId); })[0];
  if (!exam) throw new Error("Exam not found");
  const now = Date.now();

  const rows = eventRows_().filter(function (r) { return r.examId === String(examId); })
    .sort(function (a, b) { return a.ts - b.ts; });

  const map = {};
  rows.forEach(function (r) {
    const key = studentKey_(r);
    let st = map[key];
    if (!st) {
      st = map[key] = { key: key, name: r.name, studentId: r.studentId, email: r.email, status: "", statusTs: 0, lastTs: 0,
                        switches: 0, blocked: 0, ai: 0, pdf: 0, leftBrowser: 0, awaySec: 0, _k: "", _kts: 0 };
    }
    st.lastTs = r.ts;
    if (r.name) st.name = r.name;

    if (r.code === "LEFT_FORM_TAB") st.switches++;
    if (r.code === "BLOCKED_NAVIGATION") st.blocked++;
    if (r.code === "BROWSER_LOST_FOCUS") st.leftBrowser++;
    if (r.code === "RETURNED_TO_FORM") st.awaySec += r.away || 0;

    // Count AI / PDF visits once even if several events describe the same visit
    if ((r.code === "LEFT_FORM_TAB" || r.code === "BLOCKED_NAVIGATION" || r.code === "OTHER_TAB_URL") &&
        (r.category === "AI_SITE" || r.category === "PDF")) {
      const k = r.category + "|" + r.site;
      if (!(st._k === k && r.ts - st._kts < 8000)) {
        if (r.category === "AI_SITE") st.ai++; else st.pdf++;
      }
      st._k = k; st._kts = r.ts;
    }

    let status = null;
    if (r.code === "SESSION_START" || r.code === "FORM_REOPENED" || r.code === "RETURNED_TO_FORM") status = "On form";
    else if (r.code === "LEFT_FORM_TAB" || r.code === "BROWSER_LOST_FOCUS") status = "Away";
    else if (r.code === "FORM_TAB_CLOSED") status = "Form closed";
    else if (r.code === "MONITORING_STOPPED") status = "Withdrew consent";
    else if (r.code === "EXAM_ENDED") status = "Finished";
    if (status && status !== st.status) { st.status = status; st.statusTs = r.ts; }
  });

  const students = Object.keys(map).map(function (k) {
    const s = map[k];
    delete s._k; delete s._kts;
    return s;
  }).sort(function (a, b) {
    const fa = a.blocked + a.ai + a.pdf, fb = b.blocked + b.ai + b.pdf;
    if (fb !== fa) return fb - fa;
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    serverNow: now,
    exam: { id: exam.id, name: exam.name, start: exam.start, end: exam.end, lock: exam.lock,
            status: now < exam.start ? "upcoming" : (now < exam.end ? "live" : "ended") },
    students: students
  };
}

function api_getTimeline(examId, key) {
  requireTeacher_();
  const rows = eventRows_().filter(function (r) { return r.examId === String(examId) && studentKey_(r) === String(key); })
    .sort(function (a, b) { return a.ts - b.ts; });
  return rows.slice(-400).map(function (r) {
    return { ts: r.ts, label: EVENT_LABELS[r.code] || r.code, code: r.code, category: r.category,
             site: r.site, title: r.title, away: r.away, note: r.note };
  });
}

function api_getConsents() {
  requireTeacher_();
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONSENT_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 7).getDisplayValues();
  const map = {};
  vals.forEach(function (r) {
    const key = r[3] || r[2] || r[4];
    map[key] = { name: r[2], studentId: r[3], email: r[4], action: r[5], when: r[0] + " " + r[1] };
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
}
