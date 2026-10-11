// Google Apps Script: receives events from the extension and logs them to a tidy Sheet.
// Deploy as: Web app -> Execute as: Me -> Who has access: Anyone

const SECRET = "change-me";        // <-- keep the SAME secret you already use in background.js
const SHEET_NAME = "Activity Log";
const TZ = "Asia/Manila";

const HEADERS = ["Date", "Time", "Student", "Event", "Site", "Page title", "Away (sec)", "Flag"];

const EVENT_LABELS = {
  SESSION_START: "Started form",
  FORM_SUBMITTED: "Submitted form",
  FORM_TAB_CLOSED: "Closed form",
  LEFT_FORM_TAB: "Left form tab",
  RETURNED_TO_FORM: "Returned to form",
  NEW_TAB_OPENED: "Opened new tab",
  NEW_WINDOW_OPENED: "Opened new window",
  OTHER_TAB_URL: "Visited page in another tab",
  BROWSER_LOST_FOCUS: "Left the browser",
  FORM_TAB_NAVIGATED_AWAY: "Form tab went elsewhere"
};

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.secret !== SECRET) return out({ ok: false, error: "unauthorized" });

    const sheet = getSheet();
    const when = new Date(d.ts);
    sheet.appendRow([
      Utilities.formatDate(when, TZ, "yyyy-MM-dd"),
      Utilities.formatDate(when, TZ, "HH:mm:ss"),
      d.email || "(unknown)",
      EVENT_LABELS[d.event] || d.event,
      siteOf(d.url),
      d.title || "",
      d.awaySeconds === "" || d.awaySeconds === undefined ? "" : Number(d.awaySeconds),
      flagOf(d)
    ]);
    return out({ ok: true });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() { return out({ ok: true, service: "exam-focus-logger" }); }

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function siteOf(url) {
  if (!url) return "";
  if (/^(edge|chrome|chrome-extension|extension|about):/i.test(url)) return "Browser page";
  if (/^file:/i.test(url)) return "Local file";
  const m = url.match(/^https?:\/\/([^\/?#]+)/i);
  return m ? m[1].replace(/^www\./, "") : url;
}

function flagOf(d) {
  if (d.category === "AI_SITE") return "AI site";
  if (d.category === "PDF") return "PDF";
  if (d.event === "NEW_WINDOW_OPENED" && d.note === "incognito") return "Private window";
  if (d.event === "BROWSER_LOST_FOCUS") return "Other app";
  return "";
}

// Creates and formats the sheet the first time only.
function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_NAME);
  sheet.appendRow(HEADERS);
  sheet.setFrozenRows(1);

  sheet.getRange(1, 1, 1, HEADERS.length)
    .setFontWeight("bold").setFontColor("#ffffff").setBackground("#1e6b52");

  [95, 75, 210, 190, 180, 340, 85, 110].forEach(function (w, i) {
    sheet.setColumnWidth(i + 1, w);
  });

  sheet.getRange("A2:A").setNumberFormat("yyyy-mm-dd");
  sheet.getRange("B2:B").setNumberFormat("hh:mm:ss");
  sheet.getRange("F2:F").setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);

  const rule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=$H2<>""')
    .setBackground("#fce8e6")
    .setRanges([sheet.getRange("A2:H1000")])
    .build();
  sheet.setConditionalFormatRules([rule]);

  try { sheet.getRange(1, 1, sheet.getMaxRows(), HEADERS.length).createFilter(); } catch (e) {}
  return sheet;
}
