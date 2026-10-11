# Exam Focus Logger – Setup

## 1. Google Sheet + Apps Script (receiver)
1. Create a Google Sheet → **Extensions → Apps Script**.
2. Paste `Code.gs`, change `SECRET`.
3. **Deploy → New deployment → Web app** → Execute as *Me*, Access *Anyone* → copy the `/exec` URL.

## 2. Chrome extension
1. Open `background.js`, set `WEB_APP_URL`, the same `SECRET`, and (optional) `FORM_ID`.
2. Go to `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select this folder.
3. For incognito coverage: extension **Details → Allow in Incognito**.
4. For managed devices (school Chromebooks / Workspace): force-install through the Admin console
   so students can't disable it.

## Events logged (Sheet columns)
| Event | Meaning |
|---|---|
| SESSION_START / FORM_SUBMITTED / FORM_TAB_CLOSED | Form opened, submitted, closed |
| LEFT_FORM_TAB | Switched to another tab (category: AI_SITE, PDF, NEW_BLANK_TAB, OTHER_SITE, BROWSER_PAGE) |
| RETURNED_TO_FORM | Back on the form, with seconds away |
| NEW_TAB_OPENED / NEW_WINDOW_OPENED | New tab or window (incognito flagged) |
| OTHER_TAB_URL | Another tab navigated to a URL while the form was open |
| BROWSER_LOST_FOCUS | Focus moved outside the browser (other app, desktop PDF reader) |

## Limitations
- Cannot see activity on another device (phone, second laptop) or inside other apps beyond "focus lost".
- Cannot see page *content*, only URL/title.
- A PDF is detected by a `.pdf` URL; PDFs opened in a desktop app only show as BROWSER_LOST_FOCUS.
- Add more AI sites to `AI_DOMAINS` as needed.
- Treat the log as a flag for review, not proof of cheating (notifications, accidental clicks, etc.).

## Consent
Tell students what is collected before they install it (the extension shows a red REC badge while active).
