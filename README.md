A lightweight browser extension and Google Apps Script that logs tab and window switching while a student answers a **Google Form**. Events are recorded in a Google Sheet so teachers can review activity such as visits to AI sites, PDF files, new tabs and windows, and time spent away from the form.

> **Note:** This tool is a review aid, not proof of misconduct. Notifications, accidental clicks and legitimate resources can all leave entries in the log.

---

## Features

- Starts recording automatically when a Google Form is opened (red **REC** badge on the extension icon)
- Detects and flags:
  - **AI sites** (ChatGPT, Gemini, Claude, Copilot, Perplexity, DeepSeek and more)
  - **PDF files** opened in a browser tab
  - **New tabs and new windows** (private windows are flagged)
  - **Leaving the browser** for another application
- Records how many **seconds** the student was away before returning to the form
- Writes to a clean, formatted Google Sheet with highlighted flagged rows and filters
- Queues events and retries if the network drops
- Works on Microsoft Edge, Google Chrome and other Chromium browsers (Windows, macOS, Linux, ChromeOS)

---

## How it works

```
Student's browser                          Teacher's Google account
┌──────────────────────┐   HTTPS POST   ┌────────────────────────┐
│ Browser extension    │ ─────────────► │ Google Apps Script     │
│ (background.js)      │                │ web app (Code.gs)      │
│ watches tab/window   │                │        │               │
│ events on the form   │                │        ▼               │
└──────────────────────┘                │ Google Sheet           │
                                        │ ("Activity Log" tab)   │
                                        └────────────────────────┘
```

1. The extension detects a Google Form (`docs.google.com/forms/.../viewform`) and starts a session.
2. While the session is active, it listens for tab switches, new tabs and windows, URL changes and loss of window focus.
3. Each event is sent to your Apps Script web app, which checks a shared secret and appends a row to the Sheet.
4. The session ends when the form tab is closed.

---

## Repository structure

```
Forms-Activity-Tracker/
├── extension/
│   ├── manifest.json     # Extension manifest (Manifest V3)
│   └── background.js     # Tracking logic (service worker)
├── apps-script/
│   └── Code.gs           # Google Apps Script receiver
└── README.md
```

---

## Setup

### 1. Create the Google Sheet and receiver

1. Create a new Google Sheet.
2. Go to **Extensions → Apps Script**.
3. Delete the default code and paste in `apps-script/Code.gs`.
4. Change `const SECRET = "change-me";` to your own secret text.
5. (Optional) Change `TZ` to your time zone, e.g. `"Asia/Manila"`, `"America/New_York"`.
6. Click **Deploy → New deployment → Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
7. Click **Deploy**, authorize when asked, and copy the **Web app URL** (ends in `/exec`).

### 2. Configure the extension

Open `extension/background.js` and edit the `CONFIG` block at the top. Change only the text inside the quotes:

```js
const CONFIG = {
  WEB_APP_URL: "https://script.google.com/macros/s/XXXX/exec",
  SECRET: "your-secret-here",   // must match Code.gs exactly
  FORM_ID: "",                  // optional: restrict to one form's ID
};
```

### 3. Load the extension

**Microsoft Edge:** open `edge://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder.

**Google Chrome:** open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder.

Then, in the extension's **Details**:
- Turn on **Allow access to file URLs** (needed to detect PDFs opened from the computer)
- Optionally turn on **Allow in InPrivate / Incognito**

Pin the extension icon so the **REC** badge is visible.

### 4. Test

1. Open a Google Form. The badge should show **REC**.
2. Open another tab (for example an AI site or a PDF), then return to the form.
3. Check the **Activity Log** tab in your Sheet.

---

## What gets logged

| Column | Description |
|---|---|
| Date / Time | When the event happened (in the time zone set in `Code.gs`) |
| Student | Email of the browser's signed-in account (blank if not signed in) |
| Event | What happened (see below) |
| Site | Domain of the page involved |
| Page title | Title of the page involved |
| Away (sec) | Seconds away from the form (on "Returned to form") |
| Flag | `AI site`, `PDF`, `Private window`, or `Other app` |

| Event | Meaning |
|---|---|
| Started form | A Google Form was opened and recording began |
| Left form tab | Switched to another tab or window |
| Returned to form | Came back to the form, with time away |
| Opened new tab / window | A new tab or window was opened |
| Visited page in another tab | Another tab navigated to a new URL |
| Left the browser | Focus moved to another application |
| FORM_RESPONSE_PAGE | The form moved to a response page (next section or submission) |
| Closed form | The form tab was closed, ending the session |

---

## Limitations

- **Other devices** (phones, second laptops) cannot be seen.
- **Other applications** are only detected as "Left the browser"; the extension cannot see what is inside them.
- **Page content** is never read, only URLs and titles.
- Google uses the same address for **Next** and **Submit**, so submission can't be told apart from moving to the next section. Recording ends when the form tab is closed.
- A student can disable or remove an extension they installed themselves. For managed devices, force-install it through your admin console.
- The shared secret is stored inside the extension and can be read by anyone who has the files. Treat the log as a reminder tool, not tamper-proof evidence.

---

## Privacy and consent

This extension records the activity listed above, including the **URLs and titles of tabs the student visits while a form is open**. Before using it:

- Tell students exactly what is collected and why.
- Get consent where your school, institution or local law requires it.
- Limit access to the Sheet to the people who need it.
- Delete logs when they are no longer needed.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| No **REC** badge on the form | Reload the form tab. Use the form's `/viewform` link, not the editor page. If `FORM_ID` is set, make sure it matches. |
| Extension shows errors on load | Check `background.js` for a typo in `CONFIG`. Every line needs its quotes and trailing comma. |
| Nothing appears in the Sheet | Hover over the extension icon to see the last send result. Check that the URL ends in `/exec`, that both secrets match exactly, and that the deployment's access is set to **Anyone**. |
| Sheet doesn't use the latest code | After editing `Code.gs`, redeploy via **Deploy → Manage deployments → Edit → New version**, or create a new deployment and use its new URL. |
| Local PDFs aren't flagged | Turn on **Allow access to file URLs** in the extension's Details. |

