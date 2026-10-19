# MonitoredExm

A consent-based exam monitoring tool for **Google Forms**. A browser extension (for students) and a Google Apps Script dashboard (for teachers) work together to:

- let teachers **schedule exams** with a start time, end time and an allowlist of permitted sites
- **block everything else** (AI tools, PDFs, online documents, other websites) while an exam is running
- **log activity** such as tab switching, new windows, blocked attempts and time away from the form
- show teachers a **live dashboard** with per-student activity and timelines
- ask each student for **consent** before anything is recorded

> **Important:** this tool is a deterrent and a review aid, not proof of misconduct. See [Limitations](#limitations) and [Privacy and consent](#privacy-and-consent) before using it with students.

---

## How it works

```
 Student's browser                         Teacher's Google account
┌────────────────────────┐   HTTPS POST   ┌──────────────────────────────┐
│ Browser extension      │ ─────────────► │ Apps Script web app          │
│  - consent screen      │ ◄───────────── │  (student link, runs as you) │
│  - exam-window logic   │  exam schedule │        │                     │
│  - allowlist blocking  │                │        ▼                     │
│  - activity logging    │                │ Google Sheet                 │
└────────────────────────┘                │  Exam Log · Consents ·       │
                                          │  Events · Exams              │
                                          │        ▲                     │
                          Teacher opens   │        │                     │
                          ──────────────► │ Dashboard (Dashboard.html)   │
                                          │  (separate link, teachers    │
                                          │   only)                      │
                                          └──────────────────────────────┘
```

1. The teacher schedules an exam in the dashboard (form, start/end time, extra allowed sites, lock option).
2. The extension fetches the schedule from the web app every minute.
3. When a student opens that exam's form during its time window, the extension asks for consent (first time only), then starts the session.
4. While the session is active, only the form, Google sign-in, and the exam's allowed sites can be opened. Everything else is replaced with a "blocked" page, and the attempt is logged.
5. The session ends at the exam's end time, when the teacher clicks **End now**, or (if lock is off) when the student closes the form.

Students are **only** monitored on the form of an exam that is live. Other Google Forms are ignored.

---

## Features

**Student side (extension)**
- Consent screen with name and student ID; consent can be withdrawn any time from the extension icon
- Allowlist blocking with a clear "Blocked during the exam" page
- Optional lock that keeps restrictions on until the exam ends, even if the form is closed or the browser is restarted
- Logs: tab switches, new tabs/windows, blocked attempts, time away, leaving the browser
- Popup that shows what is active and when restrictions end
- Offline queue: events are saved and retried if the network drops
- Clock correction: timestamps use the server's time, not the student's device clock

**Teacher side (dashboard)**
- Exams tab: create, edit, end now, delete
- Live monitor: per-student status, last activity, tab switches, blocked attempts, AI/PDF visits, time away; click a row for the full timeline
- Consents tab: who agreed or withdrew, and when
- Access limited to approved teacher emails

---

## Repository structure

```
exam-focus-logger/
├── extension/
│   ├── manifest.json     # Extension manifest (Manifest V3)
│   ├── background.js     # Exam logic, blocking, logging (service worker)
│   ├── consent.html      # Consent screen
│   ├── consent.js
│   ├── popup.html        # Toolbar popup (status, withdraw consent)
│   ├── popup.js
│   ├── blocked.html      # Page shown when a site is blocked
│   └── blocked.js
├── apps-script/
│   ├── Code.gs           # Server: logging, exam schedule, dashboard API
│   └── Dashboard.html    # Teacher dashboard
└── README.md
```

---

## Setup (teacher, one time)

### 1. Create the Google Sheet and server

1. Create a new Google Sheet and open **Extensions → Apps Script**.
2. Replace the default code with `apps-script/Code.gs`.
3. In `Code.gs`, set:
   - `SECRET`: a long random text (must match the extension)
   - `TEACHER_EMAILS`: the Google account(s) allowed to open the dashboard
   - `TZ`: your time zone, e.g. `"Asia/Manila"`
4. Add the dashboard file: click **+** next to *Files* → **HTML**, name it exactly `Dashboard`, and paste in `apps-script/Dashboard.html`.
5. Save. In the function dropdown (with `Code.gs` open) choose `authorizeOnce`, click **Run**, and approve the permissions.

### 2. Create the two deployments

You need **two** web app deployments from the same project (**Deploy → New deployment → Web app**):

| | Student link | Dashboard link |
|---|---|---|
| Purpose | Extension sends logs and fetches the exam schedule | Teacher dashboard |
| Execute as | **Me** | **User accessing the web app** |
| Who has access | **Anyone** | **Only myself** (or "Anyone with Google account" for co-teachers) |
| Who gets it | Goes inside `background.js` | Only you; bookmark it |

After changing any code later, update each deployment: **Deploy → Manage deployments → pencil → Version: New version → Deploy**. This keeps the link the same.

### 3. Configure the extension

Open `extension/background.js` and edit the `CONFIG` block at the top (only the text inside quotes):

```js
const CONFIG = {
  WEB_APP_URL: "https://script.google.com/macros/s/XXXX/exec",  // the STUDENT link
  SECRET: "your-secret-here",                                    // same as Code.gs
  BASE_ALLOWLIST: [ "docs.google.com/forms", "forms.gle", "forms.google.com", "accounts.google.com" ],
  TEST_MODE: true,            // set to false for real exams
  FOCUS_GRACE_SECONDS: 3,
  CONSENT_VERSION: "2.0",
};
```

| Setting | Meaning |
|---|---|
| `TEST_MODE` | `true`: tabs already open before the exam are not restricted (easy testing). `false`: every tab is restricted. |
| `BASE_ALLOWLIST` | Sites that are always allowed (needed for Google Forms). Extra sites are added per exam in the dashboard. |
| `FOCUS_GRACE_SECONDS` | "Left the browser" is only logged if focus stays away this long. |
| `CONSENT_VERSION` | Change it after editing `consent.html` so students must agree again. |

### 4. Load the extension

- **Microsoft Edge:** `edge://extensions` → turn on **Developer mode** → **Load unpacked** → choose the `extension` folder.
- **Google Chrome:** `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose the `extension` folder.

In the extension's **Details**, turn on **Allow access to file URLs** (to detect local PDFs). Pin the icon so the status badge is visible.

---

## Running an exam

1. Open your **dashboard link** → **Exams** → **+ New exam**.
2. Enter a name and paste the form's **public link** (in Google Forms: **Send → link icon**, with "Shorten URL" turned off). The editor link (ending in `/edit`) is rejected.
3. Set the start and end times. Add any extra allowed sites (one per line, e.g. `desmos.com`).
4. Choose whether to keep restrictions on until the exam ends, even if the form is closed.
5. Click **Save exam**, then open **Live monitor** during the exam.

**Students** install the extension once (load the folder, or from a store listing). At their first exam they read the notice, enter their name and ID, and agree.

### Extension badge

| Badge | Meaning |
|---|---|
| **REC** | Exam session active and the form is open |
| **LOCK** | Exam still locked, but the form tab is closed |
| (none) | No exam in progress |
| amber background | The last send to the Sheet failed (hover the icon for details) |

---

## What gets logged

The Sheet gets four tabs, created automatically:

| Tab | Contents |
|---|---|
| **Exam Log** | Readable timeline with flags, highlighted red for flagged rows |
| **Consents** | Who agreed or withdrew, and when |
| **Events** | Raw data used by the dashboard (do not edit) |
| **Exams** | The exam schedule (manage it from the dashboard) |

| Event | Meaning |
|---|---|
| Started form / Reopened form | Session began, or the form was reopened during a lock |
| Left form tab / Returned to form | Switched away, with seconds away on return |
| Opened new tab / window | New tab or window (private windows are flagged) |
| Visited page in another tab | Another tab navigated to a new address |
| Blocked by allowlist | A page that is not allowed was replaced with the blocked page |
| Left the browser | Focus stayed away from the browser beyond the grace period |
| Next page / submitted | The form moved to a response page (Google uses one address for both) |
| Closed form | The form tab was closed |
| Monitoring stopped | The student withdrew consent during an exam |
| Exam ended | The exam window ended or the teacher ended it |

---

## Limitations

- **Other browsers, other devices and desktop apps are not covered.** Leaving the browser is only noted as "Left the browser".
- **Browser features that are not tabs** (for example Edge's Copilot sidebar) cannot be seen or blocked.
- **A student can disable or remove an extension they installed themselves**, or withdraw consent. This shows up as missing activity or a withdrawal record. For high-stakes exams, consider Safe Exam Browser or managed devices.
- **Live status is based on each student's last logged event.** There is no heartbeat, so a student who closed their laptop still shows as "On form".
- **Names and student IDs are typed by students** and are not verified.
- **Page content is never read.** Only URLs and page titles are recorded.
- **Submission cannot be detected exactly**, because Google Forms uses the same page for "Next" and "Submit".
- **Firefox and Safari are not supported** (Chromium browsers only).
- The dashboard reads the most recent ~20,000 events, which is plenty for a class but not for very large deployments.

---

## Privacy and consent

The extension records, **only during a live exam and only on that exam's form**:

- the name and student ID the student enters, and the email of the account signed in to the browser (if any)
- tabs and windows opened, switched to or closed, with page addresses (URLs) and titles
- time away from the form, and blocked attempts

It does **not** record form answers, keystrokes, passwords, screenshots, page contents or files.

Before using it:

- Tell students exactly what is collected and why, and get consent where your school or local law requires it (parental consent may apply to minors).
- Review and adapt the notice in `extension/consent.html`, then bump `CONSENT_VERSION`.
- Limit access to the Sheet and dashboard to the people who need it, and delete logs when no longer needed.

This README and the notice are not legal advice. Check them against your school's policy and local data privacy rules.

---

## Security notes

- **Never commit your real `WEB_APP_URL` or `SECRET`.** Keep the placeholders (`PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`, `change-me`) in the repository and use a separate private copy for deployment.
- The student link and secret are inside the extension files and can be read by anyone who has them. Treat the log as a review aid, not tamper-proof evidence.
- The dashboard link only works for accounts listed in `TEACHER_EMAILS`, and every dashboard function re-checks the caller.
- Student-controlled text (names, page titles) is stored as plain text, so it cannot run as a spreadsheet formula, and the dashboard renders it as text.

---

## Troubleshooting

| Problem | What to check |
|---|---|
| No **REC** badge on the form | Is an exam scheduled for that exact form, and live right now? Use the form's public link when creating the exam. Has the student agreed to the notice? |
| Dashboard says "Access denied" | Your email is not in `TEACHER_EMAILS`, or you opened the student link instead of the dashboard link. |
| Nothing appears in the Sheet | Hover over the extension icon to see the last send result. Check the student link ends in `/exec`, both secrets match exactly, and that deployment is set to **Anyone**. |
| Sheet or dashboard runs old code | Update each deployment: **Manage deployments → pencil → New version → Deploy**. |
| A student is blocked from a site they need | Add it to the exam's extra allowed sites in the dashboard. |
| Restrictions won't turn off while testing | The exam has the lock on. Use **End now** in the dashboard, withdraw consent from the extension icon, or untick the lock when creating test exams. |
| Extension shows errors on load | Check `background.js` for a typo in the `CONFIG` block. Every line needs its quotes and trailing comma. |
| Local PDFs are not flagged | Turn on **Allow access to file URLs** in the extension's Details. |

